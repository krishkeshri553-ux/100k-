import type { Store } from "../db/store.js";
import type { Deal, Payment } from "../db/types.js";
import { logEvent } from "../lib/audit.js";
import { idemKey } from "../lib/hash.js";
import { moveStage } from "../pipeline/stages.js";

export class RevenueError extends Error {}

const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

function assertAmount(n: unknown): number {
  const v = typeof n === "string" ? parseFloat(n) : (n as number);
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new RevenueError("Amount must be a non-negative number");
  return Math.round(v * 100) / 100;
}

export async function createDeal(store: Store, input: { prospectId: string; title?: string; plan?: string | null; contractValue: number; probability?: number | null; status?: "open" | "proposal"; currency?: string }): Promise<Deal> {
  const p = await store.get("prospects", input.prospectId);
  if (!p) throw new RevenueError("Prospect not found");
  if ((input.currency ?? "USD") !== "USD") throw new RevenueError("Only USD is supported in v1 (all published prices are USD).");
  const prob = input.probability ?? null;
  if (prob !== null && (prob < 0 || prob > 1)) throw new RevenueError("Probability must be between 0 and 1");
  const deal = await store.insert("deals", {
    prospect_id: p.id, title: input.title ?? `Authority Flywheel™ — ${p.full_name}`, plan: input.plan ?? null, status: input.status ?? "open",
    contract_value: assertAmount(input.contractValue), probability: prob, market: p.market, lead_source: p.tags.includes("source:content") ? "content" : p.source,
    is_synthetic: p.is_synthetic,
  });
  if (deal.status === "proposal") await moveStage(store, p, "proposal_sent", { actor: "owner", source: "tracker", reason: "proposal sent" });
  await logEvent(store, { type: "deal.created", source: "tracker", actor: "owner", prospect_id: p.id, summary: `Deal opened: ${p.full_name} · ${money(deal.contract_value)} (${deal.status})`, data: { deal_id: deal.id }, is_synthetic: p.is_synthetic });
  return deal;
}

export async function updateDealStatus(store: Store, dealId: string, status: "open" | "proposal" | "won" | "lost", opts: { signedAt?: string; lostReason?: string; contractValue?: number } = {}): Promise<Deal> {
  const d = await store.get("deals", dealId);
  if (!d) throw new RevenueError("Deal not found");
  const p = await store.get("prospects", d.prospect_id);
  const now = new Date().toISOString();
  const patch: Partial<Deal> = { status };
  if (opts.contractValue !== undefined) patch.contract_value = assertAmount(opts.contractValue);
  if (status === "won") { patch.signed_at = opts.signedAt ?? now; patch.closed_at = now; patch.probability = 1; }
  if (status === "lost") { patch.closed_at = now; patch.lost_reason = opts.lostReason ?? null; patch.probability = 0; }
  const updated = await store.update("deals", d.id, patch);
  if (p) {
    const stage = status === "won" ? "won" : status === "lost" ? "lost" : status === "proposal" ? "proposal_sent" : null;
    if (stage) await moveStage(store, p, stage, { actor: "owner", source: "tracker", reason: `deal ${status}` });
  }
  await logEvent(store, {
    type: status === "won" ? "client.won" : `deal.${status}`, source: "tracker", actor: "owner", prospect_id: d.prospect_id,
    summary: status === "won" ? `Client won: ${p?.full_name ?? "prospect"} · signed ${money(updated.contract_value)}` : `Deal ${status}: ${p?.full_name ?? ""}${opts.lostReason ? " — " + opts.lostReason : ""}`,
    data: { deal_id: d.id, value: updated.contract_value }, is_synthetic: d.is_synthetic,
  });
  return updated;
}

export async function addInvoice(store: Store, input: { dealId: string; amount: number; dueAt?: string | null; invoiceRef?: string | null }): Promise<Payment> {
  const d = await store.get("deals", input.dealId);
  if (!d) throw new RevenueError("Deal not found");
  const amount = assertAmount(input.amount);
  const key = idemKey("invoice", d.id, input.invoiceRef ?? `${amount}|${input.dueAt ?? ""}`);
  const { row, created } = await store.insertIfAbsent("payments", { deal_id: d.id, amount, currency: "USD", status: "outstanding", due_at: input.dueAt ?? null, invoice_ref: input.invoiceRef ?? null, idempotency_key: key, is_synthetic: d.is_synthetic }, ["idempotency_key"]);
  if (created) await logEvent(store, { type: "invoice.created", source: "tracker", actor: "owner", prospect_id: d.prospect_id, summary: `Invoice ${input.invoiceRef ?? ""} ${money(amount)} outstanding`, data: { payment_id: row.id }, is_synthetic: d.is_synthetic });
  return row;
}

/**
 * Cash is counted as collected only when the owner marks the invoice paid. `verified` means the owner
 * confirmed the money is in the bank account — the tracker shows both, and the headline uses verified cash.
 */
export async function markPaid(store: Store, paymentId: string, opts: { paidAt?: string; verified: boolean }): Promise<Payment> {
  const pay = await store.get("payments", paymentId);
  if (!pay) throw new RevenueError("Invoice not found");
  if (pay.status === "void") throw new RevenueError("Invoice is void");
  const updated = await store.update("payments", pay.id, { status: "paid", paid_at: opts.paidAt ?? pay.paid_at ?? new Date().toISOString(), verified: opts.verified });
  const d = await store.get("deals", pay.deal_id);
  await logEvent(store, {
    type: opts.verified ? "revenue.verified" : "revenue.recorded", source: "tracker", actor: "owner", prospect_id: d?.prospect_id ?? null,
    summary: `${opts.verified ? "Revenue collection verified" : "Payment recorded (not yet verified)"}: ${money(pay.amount)}`, data: { payment_id: pay.id, amount: pay.amount }, is_synthetic: pay.is_synthetic,
  });
  return updated;
}

export async function voidInvoice(store: Store, paymentId: string) {
  const pay = await store.get("payments", paymentId);
  if (!pay) throw new RevenueError("Invoice not found");
  if (pay.status === "paid") throw new RevenueError("Cannot void a paid invoice");
  return store.update("payments", pay.id, { status: "void" });
}
