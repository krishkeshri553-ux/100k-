/**
 * Site-wide behaviour. Small, dependency-free, progressive enhancement only:
 * every feature here degrades to a working page without JavaScript.
 */

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/* ---------- Header: border on scroll ---------- */
const header = document.querySelector<HTMLElement>('[data-header]');
if (header) {
  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

/* ---------- Mobile navigation ---------- */
const toggle = document.querySelector<HTMLButtonElement>('[data-nav-toggle]');
const panel = document.querySelector<HTMLElement>('[data-mobile-nav]');
const label = document.querySelector<HTMLElement>('[data-nav-label]');
if (toggle && panel) {
  const setOpen = (open: boolean) => {
    toggle.setAttribute('aria-expanded', String(open));
    panel.classList.toggle('is-open', open);
    document.body.style.overflow = open ? 'hidden' : '';
    if (label) label.textContent = open ? 'Close menu' : 'Open menu';
    if (open) panel.querySelector<HTMLAnchorElement>('a')?.focus({ preventScroll: true });
  };
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  panel.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('a')) setOpen(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') { setOpen(false); toggle.focus(); }
  });
  window.matchMedia('(min-width: 961px)').addEventListener('change', (e) => { if (e.matches) setOpen(false); });
}

/* ---------- Reveal on scroll ---------- */
const revealables = document.querySelectorAll<HTMLElement>('[data-reveal]');
if ('IntersectionObserver' in window && !reduceMotion.matches) {
  const io = new IntersectionObserver(
    (entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } }),
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  );
  revealables.forEach((el) => io.observe(el));
} else {
  revealables.forEach((el) => el.classList.add('is-in'));
}

/* ---------- Videos: lazy-load, hover previews, play-in-view ---------- */
// Videos carry their source in data-src so nothing downloads until needed.
const loadVideo = (v: HTMLVideoElement) => {
  if (v.dataset.loaded) return;
  v.querySelectorAll<HTMLSourceElement>('source[data-src]').forEach((s) => { s.src = s.dataset.src!; });
  v.load();
  v.dataset.loaded = '1';
};

// Hover previews on portfolio items (pointer devices only).
const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
document.querySelectorAll<HTMLElement>('[data-preview]').forEach((card) => {
  const v = card.querySelector<HTMLVideoElement>('video');
  if (!v || !canHover || reduceMotion.matches) return;
  card.addEventListener('pointerenter', () => { loadVideo(v); v.play().catch(() => {}); card.classList.add('is-playing'); });
  card.addEventListener('pointerleave', () => { v.pause(); card.classList.remove('is-playing'); });
});

// Ambient videos (hero reel): only play while visible, never with reduced motion.
const ambient = document.querySelectorAll<HTMLVideoElement>('video[data-ambient]');
if (ambient.length && 'IntersectionObserver' in window && !reduceMotion.matches) {
  const vio = new IntersectionObserver((entries) => entries.forEach((en) => {
    const v = en.target as HTMLVideoElement;
    if (en.isIntersecting) { loadVideo(v); v.play().catch(() => {}); } else { v.pause(); }
  }), { threshold: 0.25 });
  ambient.forEach((v) => vio.observe(v));
}

/* ---------- Click-to-play embeds (YouTube/Vimeo load only on click) ---------- */
document.querySelectorAll<HTMLButtonElement>('[data-embed]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const iframe = document.createElement('iframe');
    iframe.src = `${btn.dataset.embed}${btn.dataset.embed!.includes('?') ? '&' : '?'}autoplay=1`;
    iframe.title = btn.dataset.title || 'Video';
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.allowFullscreen = true;
    iframe.className = 'embed-frame';
    btn.replaceWith(iframe);
  });
});

/* ---------- Hero timecode ---------- */
const tc = document.querySelector<HTMLElement>('[data-timecode]');
if (tc && !reduceMotion.matches) {
  const fps = 24;
  let frame = 12 * 60 * fps + 48 * fps + 16;
  const pad = (n: number) => String(n).padStart(2, '0');
  const render = () => {
    const f = frame % fps, s = Math.floor(frame / fps) % 60, m = Math.floor(frame / fps / 60) % 60, h = Math.floor(frame / fps / 3600);
    tc.textContent = `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
  };
  let last = 0, running = true;
  const tick = (t: number) => {
    if (running && t - last > 1000 / fps) { frame++; render(); last = t; }
    requestAnimationFrame(tick);
  };
  document.addEventListener('visibilitychange', () => { running = !document.hidden; });
  requestAnimationFrame(tick);
}
