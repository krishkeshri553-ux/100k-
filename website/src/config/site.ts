/**
 * SITE CONFIGURATION — the single place for brand, contact, navigation and CTA wording.
 *
 * Anything marked `PLACEHOLDER` is not yet confirmed by the business owner.
 * Replace it before launch (see website/README.md → "Before launch").
 */

export const site = {
  name: 'Longform Edits',
  legalName: 'Longform Edits', // PLACEHOLDER: replace with the registered business name if different
  url: 'https://longformedits.com',
  tagline: 'Done-for-you long-form video editing',
  description:
    'Longform Edits is a done-for-you long-form video editing service for YouTube creators, podcasters, educators and brands. Send your footage — get a paced, polished video back.',
  locale: 'en_US',
  lang: 'en',

  /** PLACEHOLDER: confirm this inbox exists before launch. */
  email: 'hello@longformedits.com',

  /** Add real profile URLs when ready; empty strings are not rendered. */
  social: {
    youtube: '',
    instagram: '',
    linkedin: '',
    x: '',
  },

  /** Default social preview image (1200×630). Regenerate with `npm run og`. */
  ogImage: '/og/default.png',

  /**
   * Blog drafts (`draft: true`) are shown only in `npm run dev`, with a
   * "Draft — under review" banner, so you can review them. Production builds
   * leave them out entirely. The Blog link and category pages appear on the
   * live site once at least one article has `draft: false`.
   */
  showDrafts: import.meta.env.DEV,
} as const;

/** One primary CTA, used everywhere. */
export const cta = {
  primary: { label: 'Start Your Project', href: '/contact/' },
  secondary: { label: 'View Our Work', href: '/work/' },
} as const;

export const nav = [
  { label: 'Work', href: '/work/' },
  { label: 'Services', href: '/services/' },
  { label: 'Process', href: '/process/' },
  { label: 'Pricing', href: '/pricing/' },
  { label: 'Blog', href: '/blog/' },
  { label: 'Contact', href: '/contact/' },
] as const;
