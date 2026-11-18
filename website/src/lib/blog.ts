import { getCollection, type CollectionEntry } from 'astro:content';
import { site } from '../config/site';

export type Post = CollectionEntry<'blog'>;

/** All posts that should exist as pages, newest first. */
export async function getPosts(): Promise<Post[]> {
  const all = await getCollection('blog', ({ data }) => site.showDrafts || !data.draft);
  return all.sort((a, b) => b.data.publishDate.valueOf() - a.data.publishDate.valueOf());
}

/** Categories that have at least one visible post. */
export async function activeCategories() {
  const { categories } = await import('../config/blog');
  const posts = await getPosts();
  return categories.filter((c) => posts.some((p) => p.data.category === c.slug));
}

export const readingTime = (body = '') => Math.max(1, Math.round(body.trim().split(/\s+/).length / 230));

export const formatDate = (d: Date) =>
  d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

export function relatedPosts(post: Post, posts: Post[], n = 3): Post[] {
  const others = posts.filter((p) => p.id !== post.id);
  const picked = post.data.related.map((s) => others.find((p) => p.id === s)).filter(Boolean) as Post[];
  const rest = others
    .filter((p) => !picked.includes(p))
    .sort((a, b) => Number(b.data.category === post.data.category) - Number(a.data.category === post.data.category));
  return [...picked, ...rest].slice(0, n);
}
