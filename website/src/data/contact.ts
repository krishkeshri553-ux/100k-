/**
 * CONTACT FORM OPTIONS. The server (api/contact.js) validates against the
 * same field names. Package options are generated from the pricing config.
 */
import { plans, formatPrice } from '../config/pricing';

export const contentTypes = [
  'YouTube talking-head',
  'Educational',
  'Business & finance',
  'Podcast / interview',
  'Documentary / storytelling',
  'Faceless YouTube',
  'Personal brand',
  'Vlog / lifestyle',
  'Other long-form',
];

export const finalLengths = ['Under 10 minutes', '10–20 minutes', '20–40 minutes', '40+ minutes', 'It varies'];
export const rawLengths = ['Under 30 minutes', '30–60 minutes', '1–2 hours', '2+ hours', 'It varies'];
export const volumes = ['1 (one-off)', '2–3', '4', '5–7', '8', '9+'];

export const packageOptions = [
  ...plans.map((p) => ({ value: p.id, label: `${p.name} — ${formatPrice(p.price)} ${p.period}` })),
  { value: 'unsure', label: 'Not sure yet — recommend one' },
];

export const budgets = [
  'Up to $150 per video',
  '$150–$500 per month',
  '$500–$900 per month',
  '$900+ per month',
  'Not sure yet',
];
