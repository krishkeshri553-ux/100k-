/**
 * FAQ — answers use only established facts (pricing config) and describe
 * the process honestly. Anything the business has not yet decided is phrased
 * as "we confirm this with you" rather than invented as a policy.
 * Items marked `confirm: true` should be reviewed by the owner before launch.
 */
import { facts, formatPrice, plans } from '../config/pricing';

const [single, four, eight] = plans;

export interface Faq {
  q: string;
  a: string;
  confirm?: boolean;
}

export const faqs: Faq[] = [
  {
    q: 'What types of videos do you edit?',
    a: 'Long-form videos only: YouTube talking-head videos, educational content, business and finance videos, podcasts and interviews, documentary and storytelling pieces, faceless YouTube videos, personal brand videos, and vlogs. We don’t edit short-form clips or manage social accounts.',
  },
  {
    q: 'What footage should I provide?',
    a: 'Your raw recordings, plus anything that shapes the edit: a short brief, reference videos you like, your logo and fonts, any B-roll or screen recordings you have, and notes on music or style. The clearer the brief, the closer the first draft.',
  },
  {
    q: 'How long does editing take?',
    a: `The first edited draft is delivered within ${facts.firstDraft} of us starting your video. The time to final delivery depends on how many rounds of feedback you want.`,
  },
  {
    q: 'What is the typical final video length?',
    a: `Our Single Video package covers a final video of ${facts.finalLength}. If your format runs longer or shorter, tell us in your enquiry and we’ll confirm what works before we start.`,
  },
  {
    q: 'How much raw footage can I send?',
    a: `The Single Video package covers up to ${facts.rawFootage} of raw footage. If your recordings run longer, mention it in your enquiry so we can confirm scope before editing begins.`,
    confirm: true,
  },
  {
    q: 'Are revisions included?',
    a: 'Yes. Every package includes unlimited revisions. You review the draft, send your notes, and we work through them until the video is ready.',
  },
  {
    q: 'Is a thumbnail included?',
    a: 'Yes. The Single Video package includes a thumbnail, and the monthly plans include a thumbnail for each video.',
  },
  {
    q: 'How does the editing process work?',
    a: 'Five steps: you submit your footage and brief, we organise it and build the edit, you receive a first draft, you send feedback and we revise, and then we deliver the final video.',
  },
  {
    q: 'How do I get started?',
    a: 'Fill in the project form on our contact page. Tell us about your channel, the kind of content you make and how many videos you need. We’ll reply by email to confirm the details and how to send your footage.',
  },
  {
    q: 'How do I choose a package?',
    a: `If you want to try us first, start with ${single.name} at ${formatPrice(single.price)}. If you publish weekly, ${four.name} at ${formatPrice(four.price)} a month covers a video a week. Publishing twice a week or running a content team? ${eight.name} at ${formatPrice(eight.price)} a month covers eight. Not sure? Pick “Not sure yet” on the form and we’ll recommend one.`,
  },
  {
    q: 'What happens after I submit my footage?',
    a: `We review your footage and brief, then begin the edit. Your first draft arrives within ${facts.firstDraft}. You leave feedback, we revise, and once you’re happy we deliver the final video and thumbnail.`,
  },
];
