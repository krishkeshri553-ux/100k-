/**
 * Remark plugin: replaces {{tokens}} in Markdown with values from the pricing
 * config, so blog articles can never show a stale price.
 *   {{price:single}} {{price:monthly-4}} {{price:monthly-8}}
 *   {{firstDraft}} {{finalLength}} {{rawFootage}}
 */
import { plans, facts, formatPrice } from '../config/pricing';

const tokens: Record<string, string> = {
  ...Object.fromEntries(plans.map((p) => [`price:${p.id}`, formatPrice(p.price)])),
  firstDraft: facts.firstDraft,
  finalLength: facts.finalLength,
  rawFootage: facts.rawFootage,
};

type Node = { type: string; value?: string; url?: string; children?: Node[] };

const replace = (s: string) =>
  s.replace(/\{\{\s*([\w:-]+)\s*\}\}/g, (m, k) => {
    if (!(k in tokens)) throw new Error(`Unknown content token ${m}`);
    return tokens[k];
  });

export function remarkTokens() {
  const walk = (node: Node) => {
    if ((node.type === 'text' || node.type === 'inlineCode') && node.value) node.value = replace(node.value);
    node.children?.forEach(walk);
  };
  return (tree: Node) => walk(tree);
}
