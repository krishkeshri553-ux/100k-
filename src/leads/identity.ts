import { config } from "../lib/config.js";
import type { Market } from "../db/types.js";

/** Canonical LinkedIn profile URL: https://www.linkedin.com/in/<slug> (lowercase, no query, no trailing slash). */
export function normaliseLinkedinUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/(in|pub|sales\/lead|sales\/people)\/([^/?#]+)/i);
  if (!m) return null;
  const kind = m[1].toLowerCase();
  let slug: string;
  try {
    slug = decodeURIComponent(m[2]).toLowerCase();
  } catch {
    slug = m[2].toLowerCase();
  }
  // Sales Navigator lead URLs carry an opaque id; keep them distinct but stable.
  if (kind.startsWith("sales")) return `https://www.linkedin.com/sales/lead/${slug.split(",")[0]}`;
  return `https://www.linkedin.com/in/${slug}`;
}

export function normaliseEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

export function normaliseName(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(mr|mrs|ms|dr|mba|cips|ceo)\b\.?/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Identity resolution order: LinkedIn URL > email > name + company > name alone.
 * The same person imported from a message export, a connections export and a CRM CSV resolves to one key
 * as long as any strong identifier overlaps (the reactivation engine also merges on secondary keys).
 */
export function identityKey(p: { linkedin_url?: string | null; email?: string | null; full_name: string; company?: string | null }): string {
  const li = normaliseLinkedinUrl(p.linkedin_url);
  if (li) return "li:" + li.replace("https://www.linkedin.com/", "");
  const em = normaliseEmail(p.email);
  if (em) return "em:" + em;
  const n = normaliseName(p.full_name);
  const c = p.company ? normaliseName(p.company) : "";
  return c ? `nc:${n}|${c}` : `n:${n}`;
}

export function splitName(full: string): { first: string | null; last: string | null } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: null, last: null };
  return { first: parts[0], last: parts.length > 1 ? parts.slice(1).join(" ") : null };
}

/**
 * Detect market from location first, then headline/company keywords. "other" only when a real location is known
 * and matches no target market; otherwise "unknown" (never a guess).
 */
export function detectMarket(location: string | null | undefined, ...extra: (string | null | undefined)[]): Market {
  const texts = [location, ...extra];
  const hay = " " + texts.filter(Boolean).join(" ").toLowerCase().replace(/[(),|·•-]/g, " ") + " ";
  if (hay.trim() === "") return "unknown";
  for (const m of [...config.revenue.markets].sort((a, b) => a.priority - b.priority)) {
    if (m.keywords.some((k) => hay.includes(k.startsWith(" ") ? k : " " + k + " ") || (k.length > 4 && hay.includes(k)))) return m.id as Market;
  }
  return location && location.trim() ? "other" : "unknown";
}
