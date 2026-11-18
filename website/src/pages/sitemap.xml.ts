import type { APIRoute } from 'astro';
import { site } from '../config/site';
import { categories } from '../config/blog';
import { getPosts } from '../lib/blog';

// Only indexable pages: drafts, thanks and 404 pages are excluded.
export const GET: APIRoute = async () => {
  const posts = (await getPosts()).filter((p) => !p.data.draft);
  const today = new Date().toISOString().slice(0, 10);
  const staticPages = ['/', '/work/', '/services/', '/process/', '/pricing/', '/contact/', '/privacy/', ...(posts.length ? ['/blog/'] : [])];
  const catPages = categories
    .filter((c) => posts.some((p) => p.data.category === c.slug))
    .map((c) => `/blog/category/${c.slug}/`);

  const entries = [
    ...staticPages.map((path) => ({ path, lastmod: today })),
    ...catPages.map((path) => ({ path, lastmod: today })),
    ...posts.map((p) => ({ path: `/blog/${p.id}/`, lastmod: (p.data.updatedDate ?? p.data.publishDate).toISOString().slice(0, 10) })),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map((e) => `  <url><loc>${new URL(e.path, site.url).href}</loc><lastmod>${e.lastmod}</lastmod></url>`).join('\n')}
</urlset>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
