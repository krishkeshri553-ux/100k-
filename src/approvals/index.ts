import type { Store } from "../db/store.js";
import type { Draft, Prospect } from "../db/types.js";
import { getSetting, logEvent, setSetting } from "../lib/audit.js";
import { idemKey, normaliseForCompare, sha256 } from "../lib/hash.js";
import { refreshInteractionDates, setDoNotContact } from "../leads/reactivation.js";
import { checkDraft, isBlocked } from "../outreach/guardrails.js";
import { moveStage } from "../pipeline/stages.js";

export class ApprovalError extends Error {}

/** Flags the owner may knowingly approve (commercial decisions). Everything else must be fixed by editing. */
export const OWNER_OVERRIDABLE = new Set(["discount", "contract_commitment", "unapproved_price", "generic_duplicate", "repeats_previous"]);

const SRC = "tracker";

async function loadDraft(store: Store, id: string) {
  const d = await store.get("drafts", id);
  if (!d) throw new ApprovalError("Draft not found");
  const p = await store.get("prospects", d.prospect_id);
  if (!p) throw new ApprovalError("Prospect not found");
  return { d, p };
}

function assertContactable(p: Prospect) {
  if (p.contact_status !== "ok") throw new ApprovalError(`${p.full_name} is marked ${p.contact_status.replace(/_/g, " ")} — no outreach allowed.`);
}

export async function editDraft(store: Store, id: string, body: string, subject?: string | null): Promise<Draft> {
  const { d, p } = await loadDraft(store, id);
  if (["sent_manually", "rejected", "superseded"].includes(d.status)) throw new ApprovalError(`Cannot edit a ${d.status} draft`);
  const flags = checkDraft(body, { kind: d.kind, firstName: p.first_name, subject: subject ?? d.subject, otherBodies: [] }).concat(
    d.guardrail_flags.filter((f) => f.code === "inmail_unverified"),
  );
  const updated = await store.update("drafts", id, { body: body.trim(), subject: subject ?? d.subject, guardrail_flags: flags, status: isBlocked(flags) ? "blocked" : "pending_approval", body_hash: sha256(normaliseForCompare(body, p.first_name)) });
  await logEvent(store, { type: "draft.edited", source: SRC, actor: "owner", prospect_id: p.id, summary: `Owner edited ${d.kind.replace(/_/g, " ")} for ${p.full_name}`, is_synthetic: p.is_synthetic });
  return updated;
}

export async function approveDraft(store: Store, id: string, opts: { body?: string; subject?: string | null; acknowledgeFlags?: string[] } = {}): Promise<Draft> {
  let { d, p } = await loadDraft(store, id);
  assertContactable(p);
  if (opts.body !== undefined && opts.body.trim() !== d.body) d = await editDraft(store, id, opts.body, opts.subject);
  if (!["pending_approval", "blocked", "snoozed"].includes(d.status)) throw new ApprovalError(`Draft is ${d.status}; only pending drafts can be approved`);
  const ack = new Set(opts.acknowledgeFlags ?? []);
  const unresolved = d.guardrail_flags.filter((f) => f.severity === "block" && !(OWNER_OVERRIDABLE.has(f.code) && ack.has(f.code)));
  if (unresolved.length) throw new ApprovalError("Fix before approving: " + unresolved.map((f) => f.message).join(" "));
  const updated = await store.update("drafts", id, { status: "approved", decided_at: new Date().toISOString() });
  await moveStage(store, p, "approved", { actor: "owner", source: SRC, reason: `${d.kind} approved` });
  await logEvent(store, {
    type: "draft.approved", source: SRC, actor: "owner", prospect_id: p.id,
    summary: `Approved ${d.kind.replace(/_/g, " ")} for ${p.full_name} — ready for you to send manually`,
    data: { draft_id: id, acknowledged: [...ack] }, is_synthetic: p.is_synthetic,
  });
  return updated;
}

export async function rejectDraft(store: Store, id: string, reason?: string): Promise<Draft> {
  const { d, p } = await loadDraft(store, id);
  if (d.status === "sent_manually") throw new ApprovalError("Already sent");
  const updated = await store.update("drafts", id, { status: "rejected", decided_at: new Date().toISOString() });
  await logEvent(store, { type: "draft.rejected", source: SRC, actor: "owner", prospect_id: p.id, summary: `Rejected ${d.kind.replace(/_/g, " ")} for ${p.full_name}${reason ? ": " + reason : ""}`, data: { reason }, is_synthetic: p.is_synthetic });
  return updated;
}

export async function snoozeDraft(store: Store, id: string, until: string): Promise<Draft> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new ApprovalError("Snooze date must be YYYY-MM-DD");
  const { d, p } = await loadDraft(store, id);
  if (!["pending_approval", "approved", "blocked"].includes(d.status)) throw new ApprovalError(`Cannot snooze a ${d.status} draft`);
  const updated = await store.update("drafts", id, { status: "snoozed", snooze_until: until });
  await logEvent(store, { type: "draft.snoozed", source: SRC, actor: "owner", prospect_id: p.id, summary: `Snoozed ${d.kind.replace(/_/g, " ")} for ${p.full_name} until ${until}`, is_synthetic: p.is_synthetic });
  return updated;
}

/** Workflow helper: snoozed drafts whose date has arrived go back to the approval queue. */
export async function wakeSnoozed(store: Store, today: string): Promise<number> {
  let n = 0;
  for (const d of await store.select("drafts", { status: "snoozed" })) {
    if (d.snooze_until && d.snooze_until <= today) {
      await store.update("drafts", d.id, { status: d.guardrail_flags.some((f) => f.severity === "block") ? "blocked" : "pending_approval", snooze_until: null });
      n++;
    }
  }
  return n;
}

/**
 * The ONLY path that records a message as sent: the owner confirms they personally sent the approved text.
 * Creates the outbound timeline entry, moves the stage, and decrements known InMail credits.
 */
export async function markSent(store: Store, id: string, opts: { sentAt?: string; finalBody?: string } = {}): Promise<Draft> {
  const { d, p } = await loadDraft(store, id);
  assertContactable(p);
  if (d.status !== "approved") throw new ApprovalError("Approve the draft before marking it as sent");
  const sentAt = opts.sentAt ?? new Date().toISOString();
  const body = opts.finalBody?.trim() || d.body;
  const updated = await store.update("drafts", id, { status: "sent_manually", sent_confirmed_at: sentAt, body });
  await store.insertIfAbsent("messages", {
    prospect_id: p.id, external_id: idemKey("owner_sent", d.id), direction: "outbound",
    channel: d.kind === "inmail" ? "inmail" : d.kind === "connection_note" ? "connection_note" : "linkedin_message",
    sent_at: sentAt, body, source: "owner_confirmed",
  }, ["external_id"]);
  const fresh = await refreshInteractionDates(store, p);
  await moveStage(store, fresh, "manually_contacted", { actor: "owner", source: SRC, reason: `${d.kind} sent by owner` });
  if (d.kind === "inmail") {
    const bal = await getSetting<number | null>(store, "inmail_credits_balance", null);
    if (typeof bal === "number") await setSetting(store, "inmail_credits_balance", Math.max(0, bal - 1));
  }
  await logEvent(store, { type: "outreach.sent_confirmed", source: SRC, actor: "owner", prospect_id: p.id, summary: `Owner confirmed ${d.kind.replace(/_/g, " ")} sent to ${p.full_name}`, data: { draft_id: id, kind: d.kind }, is_synthetic: p.is_synthetic });
  return updated;
}

/** Connection request outcome, recorded manually (accepted / declined / pending). */
export async function markConnectionOutcome(store: Store, id: string, outcome: "accepted" | "declined" | "pending"): Promise<Draft> {
  const { d, p } = await loadDraft(store, id);
  if (d.kind !== "connection_note") throw new ApprovalError("Not a connection request");
  if (d.status !== "sent_manually") throw new ApprovalError("Mark the connection request as sent first");
  const updated = await store.update("drafts", id, { outcome });
  if (outcome === "accepted") await moveStage(store, p, "connected", { actor: "owner", source: SRC, reason: "connection accepted" });
  await logEvent(store, { type: `connection.${outcome}`, source: SRC, actor: "owner", prospect_id: p.id, summary: `${p.full_name} connection request ${outcome}`, is_synthetic: p.is_synthetic });
  return updated;
}

/** Owner records a reply they received (pasting it lets the AI analyse and draft a response). */
export async function markReplied(store: Store, prospectId: string, opts: { text?: string; receivedAt?: string; sentiment?: "positive" | "neutral" | "negative" } = {}) {
  const p = await store.get("prospects", prospectId);
  if (!p) throw new ApprovalError("Prospect not found");
  const at = opts.receivedAt ?? new Date().toISOString();
  if (opts.text?.trim()) {
    await store.insertIfAbsent("messages", { prospect_id: p.id, external_id: idemKey("owner_reply", p.id, at, opts.text), direction: "inbound", channel: "linkedin_message", sent_at: at, body: opts.text.trim(), source: "owner_confirmed" }, ["external_id"]);
  }
  for (const d of await store.select("drafts", { prospect_id: p.id, status: "sent_manually" })) if (!d.outcome) await store.update("drafts", d.id, { outcome: "replied" });
  let fresh = await refreshInteractionDates(store, p);
  fresh = await moveStage(store, fresh, "replied", { actor: "owner", source: SRC, reason: "prospect replied" });
  if (opts.sentiment === "positive") fresh = await moveStage(store, fresh, "interested", { actor: "owner", source: SRC, reason: "positive reply" });
  await logEvent(store, { type: "prospect.replied", source: SRC, actor: "owner", prospect_id: p.id, summary: `${p.full_name} replied${opts.sentiment ? ` (${opts.sentiment})` : ""}`, data: { sentiment: opts.sentiment ?? null, has_text: !!opts.text }, is_synthetic: p.is_synthetic });
  return fresh;
}

export async function markDoNotContact(store: Store, prospectId: string, reason: string) {
  const p = await store.get("prospects", prospectId);
  if (!p) throw new ApprovalError("Prospect not found");
  return setDoNotContact(store, p, "do_not_contact", reason || "Owner decision", SRC, "owner");
}

export async function pendingApprovals(store: Store) {
  const drafts = [...(await store.select("drafts", { status: "pending_approval" })), ...(await store.select("drafts", { status: "blocked" }))];
  const content = await store.select("content_items", { status: "pending_approval" });
  return { drafts, content, total: drafts.length + content.length };
}
