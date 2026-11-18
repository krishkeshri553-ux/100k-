/** JSON-LD builders. Only schema that accurately describes the business — no ratings or reviews. */
import { site } from '../config/site';
import { plans, currency } from '../config/pricing';

export const serviceSchema = () => ({
  '@context': 'https://schema.org',
  '@type': 'Service',
  '@id': `${site.url}/#service`,
  name: 'Long-form video editing',
  serviceType: 'Video editing',
  description:
    'Done-for-you editing of long-form videos — YouTube talking-head, educational, business, podcast, documentary, faceless, personal brand and vlog content.',
  provider: { '@id': `${site.url}/#organization` },
  areaServed: 'Worldwide',
  url: `${site.url}/services/`,
  offers: plans.map((p) => ({
    '@type': 'Offer',
    name: p.name,
    price: p.price.toFixed(2),
    priceCurrency: currency,
    description: p.features.join('; '),
    url: `${site.url}/pricing/`,
    ...(p.recurring
      ? { priceSpecification: { '@type': 'UnitPriceSpecification', price: p.price.toFixed(2), priceCurrency: currency, billingDuration: 'P1M', unitText: 'month' } }
      : {}),
  })),
});

export const breadcrumbSchema = (crumbs: { name: string; path: string }[]) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: crumbs.map((c, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: c.name,
    item: new URL(c.path, site.url).href,
  })),
});
