/**
 * SERVICE CONTENT — formats we edit, what goes into an edit, why clients
 * choose us. All formats are long-form; nothing here is a separate service.
 */

import { facts, formatPrice, lowestPrice } from '../config/pricing';

export const formats = [
  {
    name: 'YouTube talking-head',
    detail: 'Jump cuts that keep the energy up, punch-ins for emphasis, text and B-roll where your point needs a picture.',
  },
  {
    name: 'Educational',
    detail: 'Lessons, tutorials and courses structured so viewers can follow along — callouts, diagrams, chapters.',
  },
  {
    name: 'Business & finance',
    detail: 'Charts, figures and on-screen data animated clearly, so complex ideas land on the first watch.',
  },
  {
    name: 'Podcasts & interviews',
    detail: 'Multi-camera switching, cleaned-up dialogue, and the dead air cut so the conversation moves.',
  },
  {
    name: 'Documentary & storytelling',
    detail: 'Structure first: a cold open, a reason to keep watching, and music that carries the story.',
  },
  {
    name: 'Faceless YouTube',
    detail: 'Voiceover-led videos built from B-roll, stock, motion graphics and sound — no presenter required.',
  },
  {
    name: 'Personal brand',
    detail: 'Founder and expert videos that look considered and on-brand, without looking over-produced.',
  },
  {
    name: 'Vlogs & lifestyle',
    detail: 'Hours of handheld footage shaped into a story with rhythm, sound and a clear arc.',
  },
] as const;

/**
 * Capabilities. `core: true` items are listed in every package.
 * Others are applied when the footage or the brief calls for them — we agree
 * scope before editing starts rather than promising everything on every video.
 */
export const capabilities = [
  { code: '001', name: 'Story & pacing', core: true, detail: 'We find the strongest version of your video — what to open with, what to cut, where to breathe.' },
  { code: '002', name: 'Professional cuts', core: true, detail: 'Clean, motivated cuts. Mistakes, retakes and dead air removed without making you sound chopped.' },
  { code: '003', name: 'B-roll integration', core: true, detail: 'Supporting footage, screen recordings and stills placed where they add meaning, not just movement.' },
  { code: '004', name: 'Sound design', core: true, detail: 'Whooshes, risers and ambience used with restraint, so transitions feel finished rather than loud.' },
  { code: '005', name: 'Music selection', core: true, detail: 'Tracks chosen to fit the tone and edited to the cut — in, out and under your voice.' },
  { code: '006', name: 'Thumbnail', core: true, detail: 'A thumbnail designed alongside the edit, included with every video in every package.' },
  { code: '007', name: 'Text & motion graphics', core: false, detail: 'Titles, lower thirds, callouts and animated graphics, matched to your channel style.' },
  { code: '008', name: 'Colour correction', core: false, detail: 'Balanced exposure and skin tones across cameras, so every shot looks like the same video.' },
  { code: '009', name: 'Audio cleanup', core: false, detail: 'Levels, noise and room tone treated so your voice is clear on phone speakers and headphones.' },
  { code: '010', name: 'Visual effects', core: false, detail: 'Masking, tracking and compositing when a moment genuinely needs it — never as decoration.' },
  { code: '011', name: 'Retention-minded structure', core: false, detail: 'Hooks, pattern breaks and chapter flow considered in the edit. We edit for watchability; we don’t promise numbers.' },
  { code: '012', name: 'Finishing & export', core: true, detail: 'Final pass on audio, levels and frame-accuracy, exported to the spec your platform needs.' },
] as const;

/** Differentiators — each one specific and backed by how the service works. */
export const reasons = [
  {
    title: 'Long-form is all we edit.',
    body: 'No shorts, no reels, no social management. Every edit we make is built to hold attention for ten minutes or more — that is a different craft, and it is the only one we practise.',
  },
  {
    title: `A first draft in ${facts.firstDraft}.`,
    body: 'Send footage, get a full draft back within our standard turnaround window. Your publishing schedule stops depending on when you find a free weekend.',
  },
  {
    title: 'Revisions until it’s right.',
    body: 'Unlimited revisions on every package. You review the draft, leave notes, and we work through them until the video is ready to publish.',
  },
  {
    title: 'Prices on the page.',
    body: `From ${formatPrice(lowestPrice)} per video. No quote calls, no hourly billing surprises. You know what a video costs before you send a single file.`,
  },
  {
    title: 'The same standard, every upload.',
    body: 'Monthly plans keep your brief, references and style notes carrying from one video to the next, so episode twelve looks like it belongs with episode one.',
  },
  {
    title: 'Your time goes back to the camera.',
    body: 'Editing a long-form video can take longer than recording it. Hand that part off, and spend the hours on ideas, filming and running the business.',
  },
] as const;

/** The five-step workflow. */
export const process = [
  {
    step: '01',
    title: 'Submit your footage',
    body: 'Share your raw footage with your requirements, any references you like, and assets such as logos, fonts or music preferences.',
    timecode: '00:00:00:00',
  },
  {
    step: '02',
    title: 'Editing begins',
    body: 'We organise the footage, review your brief and build the edit according to the direction you have set for the project.',
    timecode: '00:04:12:08',
  },
  {
    step: '03',
    title: 'First draft',
    body: `Your first edited draft is delivered within our standard turnaround window of ${facts.firstDraft}.`,
    timecode: '00:09:37:21',
  },
  {
    step: '04',
    title: 'Feedback & revisions',
    body: 'Review the draft and send revision requests. Every package includes unlimited revisions.',
    timecode: '00:14:02:13',
  },
  {
    step: '05',
    title: 'Final delivery',
    body: 'The final, polished video is delivered — with its thumbnail — ready for you to publish.',
    timecode: '00:18:46:00',
  },
] as const;
