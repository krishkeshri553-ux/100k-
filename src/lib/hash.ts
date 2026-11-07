import { createHash } from "node:crypto";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Stable idempotency key from parts. */
export const idemKey = (...parts: (string | number | null | undefined)[]) =>
  sha256(parts.map((p) => String(p ?? "")).join("␟")).slice(0, 40);

/** Normalise text for duplicate detection (case, whitespace, punctuation, the prospect's name). */
export function normaliseForCompare(text: string, firstName?: string | null): string {
  let t = text.toLowerCase();
  if (firstName) t = t.split(firstName.toLowerCase()).join("{name}");
  return t.replace(/[^\p{L}\p{N}{} ]+/gu, " ").replace(/\s+/g, " ").trim();
}

/** Jaccard similarity of word trigrams (0..1). Used to catch near-identical "generic" messages. */
export function similarity(a: string, b: string): number {
  const grams = (s: string) => {
    const w = s.split(" ");
    const out = new Set<string>();
    for (let i = 0; i + 2 < w.length; i++) out.add(w.slice(i, i + 3).join(" "));
    if (w.length < 3) out.add(s);
    return out;
  };
  const A = grams(a), B = grams(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}
