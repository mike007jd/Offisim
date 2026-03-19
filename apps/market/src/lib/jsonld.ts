import type { ListingDetail, CreatorProfile } from '@aics/registry-client';
import { SITE_URL } from './url';

/** JSON-LD for a marketplace listing (SoftwareApplication schema). */
export function listingJsonLd(listing: ListingDetail) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: listing.title,
    description: listing.summary,
    applicationCategory: 'AI Simulation Asset',
    operatingSystem: 'Cross-platform',
    url: `${SITE_URL}/listing/${listing.slug}`,
    author: {
      '@type': 'Person',
      name: listing.creator.display_name,
      url: `${SITE_URL}/creator/${listing.creator.handle}`,
    },
    ...(listing.version && {
      softwareVersion: listing.version.version,
    }),
    ...(listing.rating > 0 && {
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: listing.rating,
        ratingCount: listing.install_count,
      },
    }),
    ...(listing.tags &&
      listing.tags.length > 0 && {
        keywords: listing.tags.join(', '),
      }),
  };
}

/** JSON-LD for a creator profile page. */
export function creatorJsonLd(creator: CreatorProfile) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: creator.display_name,
    url: `${SITE_URL}/creator/${creator.handle}`,
    ...(creator.bio && { description: creator.bio }),
    ...(creator.website_url && { sameAs: [creator.website_url] }),
  };
}

/** JSON-LD for the marketplace home / search (WebSite + SearchAction). */
export function siteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Offisim Market',
    url: SITE_URL,
    description:
      'Browse, discover, and install AI company employees, skills, SOPs, and templates for Offisim.',
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}
