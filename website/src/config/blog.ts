/**
 * BLOG TAXONOMY + AUTHORS. Category slugs become /blog/category/<slug>/.
 * Article frontmatter references `category` and `author` by slug.
 */

export const categories = [
  { slug: 'youtube-editing', name: 'YouTube Editing', description: 'How YouTube editing works, what it costs, and how to hire for it.' },
  { slug: 'video-storytelling', name: 'Video Storytelling', description: 'Structure, story and pacing for long-form video.' },
  { slug: 'editing-and-retention', name: 'Editing & Retention', description: 'Editing decisions that help viewers stay with a long video.' },
  { slug: 'creator-growth', name: 'Creator Growth', description: 'Running a channel sustainably — without overpromising.' },
  { slug: 'content-production', name: 'Content Production', description: 'Workflows that make publishing consistently realistic.' },
  { slug: 'video-editing-tips', name: 'Video Editing Tips', description: 'Practical techniques for better long-form edits.' },
] as const;

export type CategorySlug = (typeof categories)[number]['slug'];
export const categoryBySlug = (slug: string) => categories.find((c) => c.slug === slug);

/**
 * Authors. No individual is invented — articles are credited to the
 * editorial team until real author profiles are supplied.
 */
export const authors = {
  'longform-editorial': {
    name: 'Longform Edits Editorial Team',
    role: 'Long-form video editors',
    bio: 'Written by the team at Longform Edits, where we edit long-form videos for YouTube creators, podcasters, educators and brands.',
    url: '/',
  },
} as const;

export type AuthorSlug = keyof typeof authors;

/**
 * Editorial backlog — topics planned but not yet written. Not rendered as
 * pages (no thin or fake articles). Move into src/content/blog/ when drafted.
 */
export const backlog = [
  'Why Professional Editing Matters for YouTube Creators',
  'How to Build a Consistent YouTube Content Workflow',
  'How to Edit Talking-Head Videos',
  'B-Roll Editing: How to Make Videos More Engaging',
  'How to Choose a Long-Form Video Editing Agency',
  'How to Reduce Editing Time as a Creator',
  'The Complete Guide to Outsourcing YouTube Video Editing',
];
