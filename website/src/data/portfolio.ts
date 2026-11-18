/**
 * PORTFOLIO — every item on /work and the homepage showcase comes from here.
 *
 * All entries are currently PLACEHOLDER SLOTS. They show which formats the
 * portfolio will cover; none of them is client work. To add a real project:
 *
 *   1. Put files in /public/media/portfolio/<slug>/
 *        poster.jpg   (1600×900, < 200 KB)       required
 *        preview.mp4  (6–10 s, muted, 720p, < 2 MB) optional — plays on hover
 *        full.mp4     (or use `embed` for YouTube/Vimeo)  optional
 *   2. Fill in the fields below and set `placeholder: false`.
 *   3. Only set `client` once the client has approved being named.
 *
 * Filters on /work appear automatically once at least
 * MIN_ITEMS_FOR_FILTERS real (non-placeholder) projects exist.
 */

export type Category =
  | 'Talking Head'
  | 'Educational'
  | 'Podcast'
  | 'Documentary'
  | 'Business'
  | 'Faceless';

export interface PortfolioItem {
  slug: string;
  title: string;
  category: Category;
  description: string;
  /** Final runtime, e.g. "14:32". Leave empty if unknown. */
  runtime?: string;
  /** Client or channel name — only with written approval. */
  client?: string;
  poster: string;
  /** Short muted loop for hover previews. */
  preview?: string;
  /** Self-hosted full video. */
  video?: string;
  /** YouTube or Vimeo embed URL (https://www.youtube-nocookie.com/embed/ID). */
  embed?: string;
  aspect?: '16/9' | '9/16' | '1/1';
  placeholder: boolean;
  featured?: boolean;
}

export const MIN_ITEMS_FOR_FILTERS = 6;

const ph = (n: number) => `/media/placeholders/frame-${String(n).padStart(2, '0')}.svg`;

export const portfolio: PortfolioItem[] = [
  {
    slug: 'slot-talking-head',
    title: 'Talking-head video',
    category: 'Talking Head',
    description: 'Reserved for a talking-head edit: tight jump cuts, punch-ins, on-screen text and B-roll.',
    poster: ph(1),
    placeholder: true,
    featured: true,
  },
  {
    slug: 'slot-podcast',
    title: 'Podcast episode',
    category: 'Podcast',
    description: 'Reserved for a multi-camera podcast edit with clean audio and speaker-led cutting.',
    poster: ph(2),
    placeholder: true,
    featured: true,
  },
  {
    slug: 'slot-documentary',
    title: 'Documentary-style story',
    category: 'Documentary',
    description: 'Reserved for a narrative edit built around structure, music and archival B-roll.',
    poster: ph(3),
    placeholder: true,
    featured: true,
  },
  {
    slug: 'slot-educational',
    title: 'Educational explainer',
    category: 'Educational',
    description: 'Reserved for a teaching video with diagrams, callouts and chaptered structure.',
    poster: ph(4),
    placeholder: true,
    featured: true,
  },
  {
    slug: 'slot-business',
    title: 'Business & finance breakdown',
    category: 'Business',
    description: 'Reserved for a data-led video with charts, motion graphics and clear pacing.',
    poster: ph(5),
    placeholder: true,
  },
  {
    slug: 'slot-faceless',
    title: 'Faceless YouTube video',
    category: 'Faceless',
    description: 'Reserved for a voiceover-led edit driven entirely by B-roll, graphics and sound.',
    poster: ph(6),
    placeholder: true,
  },
];

export const realProjects = portfolio.filter((p) => !p.placeholder);
export const hasRealWork = realProjects.length > 0;

/** Showreel shown in the homepage hero monitor. */
export const showreel = {
  /** PLACEHOLDER: set to '/media/showreel/reel.mp4' (muted, < 6 MB) when ready. */
  src: '' as string,
  /** Optional WebM version for smaller files. */
  srcWebm: '' as string,
  poster: '/media/placeholders/showreel.svg',
  placeholder: true,
};
