// @ts-check
import { defineConfig } from 'astro/config';
import { remarkTokens } from './src/lib/remark-tokens.ts';

// The production domain. Every canonical URL, Open Graph URL and sitemap
// entry is built from this value — change it here only.
export default defineConfig({
  site: 'https://longformedits.com',
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'auto' },
  compressHTML: true,
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  devToolbar: { enabled: false },
  markdown: { remarkPlugins: [remarkTokens] },
});
