import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { categories, authors } from './config/blog';

const categorySlugs = categories.map((c) => c.slug) as [string, ...string[]];
const authorSlugs = Object.keys(authors) as [string, ...string[]];

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string().max(80),
    /** 120–160 characters; used as the meta description. */
    description: z.string().min(80).max(170),
    category: z.enum(categorySlugs),
    author: z.enum(authorSlugs).default('longform-editorial'),
    publishDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    /** Draft articles render with a review banner + noindex, and stay out of the sitemap. */
    draft: z.boolean().default(true),
    /** Primary search intent the article answers (internal note). */
    intent: z.string().optional(),
    /** Slugs of related articles, in priority order. Falls back to same category. */
    related: z.array(z.string()).default([]),
  }),
});

export const collections = { blog };
