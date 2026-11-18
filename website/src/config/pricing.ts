/**
 * PRICING — the only place prices live.
 * Every price on the site (pricing cards, FAQ answers, structured data,
 * contact form options, blog CTAs) is read from here. Change it once.
 */

export const currency = 'USD';

export interface Plan {
  id: 'single' | 'monthly-4' | 'monthly-8';
  name: string;
  price: number;
  /** Shown after the price, e.g. "per video" or "per month". */
  period: string;
  /** Videos included. */
  videos: number;
  recurring: boolean;
  /** One-line positioning, factual — no "most popular" claims. */
  fit: string;
  features: string[];
  cta: string;
}

const core = [
  'Professional editing',
  'B-roll integration',
  'Sound design',
  'Music',
];

export const plans: Plan[] = [
  {
    id: 'single',
    name: 'Single Video',
    price: 129,
    period: 'per video',
    videos: 1,
    recurring: false,
    fit: 'One video, no commitment. The easiest way to see our work on your footage.',
    features: [
      '1 long-form video',
      'Final video length: 10–20 minutes',
      'Raw footage: up to 60 minutes',
      ...core,
      'Visual enhancements',
      'Thumbnail included',
      'Unlimited revisions',
      'First draft within 48–72 hours',
    ],
    cta: 'Get Started',
  },
  {
    id: 'monthly-4',
    name: '4 Videos',
    price: 449,
    period: 'per month',
    videos: 4,
    recurring: true,
    fit: 'A video a week, edited to the same standard every time.',
    features: [
      '4 long-form videos',
      'Consistent monthly editing',
      ...core,
      'Thumbnail for each video',
      'Unlimited revisions',
      'First draft within 48–72 hours',
    ],
    cta: 'Choose 4 Videos',
  },
  {
    id: 'monthly-8',
    name: '8 Videos',
    price: 849,
    period: 'per month',
    videos: 8,
    recurring: true,
    fit: 'Two videos a week for channels and teams publishing on a tight schedule.',
    features: [
      '8 long-form videos',
      'Consistent monthly editing',
      ...core,
      'Thumbnail for each video',
      'Unlimited revisions',
      'First draft within 48–72 hours',
    ],
    cta: 'Choose 8 Videos',
  },
];

export const lowestPrice = Math.min(...plans.map((p) => p.price));

export const formatPrice = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);

/** Derived arithmetic only (price ÷ videos) — not a discount claim. */
export const perVideo = (p: Plan) => p.price / p.videos;

export const planById = (id: string) => plans.find((p) => p.id === id);

/** Shared facts referenced by FAQ copy, hero meta line, etc. */
export const facts = {
  // Word joiners (\u2060) stop the range breaking across lines.
  firstDraft: '48\u2060–\u206072\u00a0hours',
  finalLength: '10–20 minutes',
  rawFootage: '60 minutes',
} as const;
