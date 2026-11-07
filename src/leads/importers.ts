import { parse } from "csv-parse/sync";
import { normaliseEmail, normaliseLinkedinUrl, normaliseName } from "./identity.js";

/** A person + their messages, extracted from any permitted source, before it touches the database. */
export interface ImportedContact {
  full_name: string;
  linkedin_url: string | null;
  email: string | null;
  company: string | null;
  title: string | null;
  headline: string | null;
  location: string | null;
  notes: string | null;
  deal_value_estimate: number | null;
  status_hint: string | null;
  last_contacted_at: string | null;
  do_not_contact: boolean;
  messages: ImportedMessage[];
}

export interface ImportedMessage {
  direction: "inbound" | "outbound";
  sent_at: string;
  body: string;
  channel: string;
  external_ref: string;
}

export type ImportFormat = "linkedin_messages" | "linkedin_connections" | "crm_csv";

function readCsv(text: string): Record<string, string>[] {
  // LinkedIn's Connections.csv starts with a "Notes:" preamble before the real header row.
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  let headerIdx = lines.findIndex((l) => /^\s*"?first name"?\s*,\s*"?last name"?/i.test(l));
  if (headerIdx < 0 && /^notes:?\s*$/i.test(lines[0] ?? "")) headerIdx = lines.findIndex((l, i) => i > 0 && l.trim() !== "" && !l.trim().startsWith('"'));
  const body = (headerIdx > 0 ? lines.slice(headerIdx) : lines).join("\n");
  const rows = parse(body, { columns: (h: string[]) => h.map((x) => x.trim().toLowerCase()), skip_empty_lines: true, relax_column_count: true, relax_quotes: true, trim: true }) as Record<string, string>[];
  return rows;
}

export function detectFormat(text: string): ImportFormat {
  const head = text.slice(0, 4000).toLowerCase();
  if (head.includes("conversation id") && head.includes("content")) return "linkedin_messages";
  if (head.includes("first name") && head.includes("last name") && head.includes("connected on")) return "linkedin_connections";
  return "crm_csv";
}

const toIso = (s: string | undefined | null): string | null => {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  // LinkedIn messages: "2024-03-14 09:12:33 UTC"
  const m = t.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\s*UTC)?$/i);
  if (m) return new Date(`${m[1]}T${m[2].length === 5 ? m[2] + ":00" : m[2]}Z`).toISOString();
  // Connections: "14 Mar 2024"
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * LinkedIn data export → messages.csv. Columns:
 * CONVERSATION ID, CONVERSATION TITLE, FROM, SENDER PROFILE URL, TO, RECIPIENT PROFILE URLS, DATE, SUBJECT, CONTENT, FOLDER
 * The owner is identified by OWNER_LINKEDIN_URL, else OWNER_NAME, else the participant present in the most conversations.
 */
export function parseLinkedinMessages(text: string, owner: { name: string; linkedinUrl: string | null }): ImportedContact[] {
  const rows = readCsv(text).filter((r) => (r["is message draft"] ?? "").toLowerCase() !== "yes");
  const ownerUrl = normaliseLinkedinUrl(owner.linkedinUrl);
  const ownerName = normaliseName(owner.name);

  // Infer owner by frequency if no URL match exists.
  const convByUrl = new Map<string, Set<string>>();
  for (const r of rows) {
    const u = normaliseLinkedinUrl(r["sender profile url"]);
    if (!u) continue;
    if (!convByUrl.has(u)) convByUrl.set(u, new Set());
    convByUrl.get(u)!.add(r["conversation id"]);
  }
  let inferredOwner: string | null = ownerUrl && convByUrl.has(ownerUrl) ? ownerUrl : null;
  if (!inferredOwner) {
    const byName = rows.find((r) => normaliseName(r["from"] ?? "") === ownerName);
    inferredOwner = byName ? normaliseLinkedinUrl(byName["sender profile url"]) : null;
  }
  if (!inferredOwner) {
    let best = 0;
    for (const [u, set] of convByUrl) if (set.size > best) { best = set.size; inferredOwner = u; }
  }
  const isOwner = (url: string | null, name: string) => (url && url === inferredOwner) || normaliseName(name) === ownerName;

  const byConv = new Map<string, Record<string, string>[]>();
  for (const r of rows) {
    const id = r["conversation id"] || "unknown";
    if (!byConv.has(id)) byConv.set(id, []);
    byConv.get(id)!.push(r);
  }

  const contacts = new Map<string, ImportedContact>();
  for (const [convId, msgs] of byConv) {
    // The counterpart: any non-owner sender, or the recipient of owner-sent messages.
    let name: string | null = null;
    let url: string | null = null;
    for (const m of msgs) {
      const su = normaliseLinkedinUrl(m["sender profile url"]);
      if (!isOwner(su, m["from"] ?? "")) { name = m["from"]; url = su; break; }
    }
    if (!name) {
      const m = msgs[0];
      name = (m["to"] ?? "").split(",")[0].trim() || (m["conversation title"] ?? "").replace(/^.*?\band\b\s*/i, "").trim() || null;
      url = normaliseLinkedinUrl((m["recipient profile urls"] ?? "").split(",")[0]);
    }
    if (!name) continue;
    // Skip group conversations (more than one non-owner participant): not a 1:1 sales thread.
    const others = new Set(msgs.map((m) => normaliseLinkedinUrl(m["sender profile url"])).filter((u) => u && u !== inferredOwner));
    if (others.size > 1) continue;

    const key = url ?? "name:" + normaliseName(name);
    const c = contacts.get(key) ?? {
      full_name: name.trim(), linkedin_url: url, email: null, company: null, title: null, headline: null, location: null,
      notes: null, deal_value_estimate: null, status_hint: null, last_contacted_at: null, do_not_contact: false, messages: [],
    };
    for (const m of msgs) {
      const sentAt = toIso(m["date"]);
      const body = (m["content"] ?? "").trim();
      if (!sentAt || !body) continue;
      const su = normaliseLinkedinUrl(m["sender profile url"]);
      const folder = (m["folder"] ?? "").toLowerCase();
      c.messages.push({
        direction: isOwner(su, m["from"] ?? "") ? "outbound" : "inbound",
        sent_at: sentAt,
        body,
        channel: folder.includes("inmail") || (m["subject"] ?? "").trim() ? "inmail" : "linkedin_message",
        external_ref: `${convId}|${sentAt}|${su ?? m["from"]}`,
      });
    }
    contacts.set(key, c);
  }
  return [...contacts.values()].filter((c) => c.messages.length > 0);
}

/** LinkedIn data export → Connections.csv (First Name, Last Name, URL, Email Address, Company, Position, Connected On). */
export function parseLinkedinConnections(text: string): ImportedContact[] {
  return readCsv(text)
    .map((r) => {
      const full = `${r["first name"] ?? ""} ${r["last name"] ?? ""}`.trim();
      return {
        full_name: full, linkedin_url: normaliseLinkedinUrl(r["url"]), email: normaliseEmail(r["email address"]),
        company: r["company"] || null, title: r["position"] || null, headline: null, location: null, notes: null,
        deal_value_estimate: null, status_hint: "connected", last_contacted_at: null, do_not_contact: false, messages: [],
      } satisfies ImportedContact;
    })
    .filter((c) => c.full_name);
}

const pick = (r: Record<string, string>, ...keys: string[]): string | null => {
  for (const k of keys) {
    const v = r[k];
    if (v !== undefined && v.trim() !== "") return v.trim();
  }
  return null;
};

/** Generic CRM / spreadsheet CSV with flexible headers. Optional "conversation" or "notes" columns become history. */
export function parseCrmCsv(text: string): ImportedContact[] {
  return readCsv(text)
    .map((r) => {
      const first = pick(r, "first name", "first_name", "firstname");
      const last = pick(r, "last name", "last_name", "lastname");
      const full = pick(r, "name", "full name", "full_name", "contact", "contact name", "prospect") ?? [first, last].filter(Boolean).join(" ");
      const dealRaw = pick(r, "deal value", "deal_value", "value", "amount", "potential value");
      const dnc = (pick(r, "do not contact", "dnc", "opt out", "opted out", "unsubscribed") ?? "").toLowerCase();
      const conversation = pick(r, "conversation", "conversation history", "messages", "last message");
      const lastContact = toIso(pick(r, "last contact", "last contacted", "last_contacted", "last interaction", "last activity"));
      const msgs: ImportedMessage[] = [];
      let undatedHistory: string | null = null;
      if (conversation && !lastContact) undatedHistory = conversation; // no date: keep as notes, never invent timestamps
      if (conversation && lastContact) {
        // Accept "Them: ... || Me: ..." style logs; otherwise store as one inbound note dated last contact.
        const parts = conversation.split(/\s*\|\|\s*|\n+/).filter(Boolean);
        parts.forEach((part, i) => {
          const mm = part.match(/^(me|us|krish|owner|them|prospect|they|[a-z ]{2,30})\s*:\s*(.+)$/i);
          const who = mm ? mm[1].toLowerCase() : "them";
          const outbound = ["me", "us", "krish", "owner"].includes(who);
          msgs.push({
            direction: outbound ? "outbound" : "inbound",
            sent_at: new Date(new Date(lastContact).getTime() - (parts.length - 1 - i) * 60000).toISOString(),
            body: (mm ? mm[2] : part).trim(),
            channel: "crm_note",
            external_ref: `crm|${full}|${i}|${part.slice(0, 40)}`,
          });
        });
      }
      return {
        full_name: (full ?? "").trim(),
        linkedin_url: normaliseLinkedinUrl(pick(r, "linkedin", "linkedin url", "linkedin_url", "profile url", "profile", "url")),
        email: normaliseEmail(pick(r, "email", "email address", "e-mail")),
        company: pick(r, "company", "business", "agency", "brokerage", "organisation", "organization"),
        title: pick(r, "title", "position", "job title", "role"),
        headline: pick(r, "headline"),
        location: pick(r, "location", "city", "country", "market", "region"),
        notes: [pick(r, "notes", "note", "comments", "objection"), undatedHistory ? "Undated history: " + undatedHistory : null].filter(Boolean).join("\n") || null,
        deal_value_estimate: dealRaw && !isNaN(parseFloat(dealRaw.replace(/[^0-9.]/g, ""))) ? parseFloat(dealRaw.replace(/[^0-9.]/g, "")) : null,
        status_hint: pick(r, "status", "stage", "lead status"),
        last_contacted_at: lastContact,
        do_not_contact: ["yes", "true", "1", "y", "x"].includes(dnc),
        messages: msgs.filter((m) => m.body),
      } satisfies ImportedContact;
    })
    .filter((c) => c.full_name);
}

export function parseImport(text: string, owner: { name: string; linkedinUrl: string | null }, format?: ImportFormat) {
  const f = format ?? detectFormat(text);
  const contacts = f === "linkedin_messages" ? parseLinkedinMessages(text, owner) : f === "linkedin_connections" ? parseLinkedinConnections(text) : parseCrmCsv(text);
  return { format: f, contacts };
}
