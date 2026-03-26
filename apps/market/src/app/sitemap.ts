import type { MetadataRoute } from 'next';
import { getRegistryClient } from '../lib/registry';
import { SITE_URL } from '../lib/url';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    /* ── Landing + core pages ── */
    { url: SITE_URL, lastModified: new Date(), changeFrequency: 'weekly', priority: 1.0 },
    { url: `${SITE_URL}/browse`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE_URL}/how-it-works`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE_URL}/search`, changeFrequency: 'daily', priority: 0.8 },

    /* ── Documentation ── */
    { url: `${SITE_URL}/docs`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${SITE_URL}/docs/quickstart`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${SITE_URL}/docs/concepts`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/docs/models`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/docs/creating-packages`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/docs/contributing`, changeFrequency: 'monthly', priority: 0.6 },
  ];

  /* ── Dynamic listing pages ── */
  try {
    const client = getRegistryClient();
    const result = await client.searchListings({ sort: 'newest', per_page: 100 });
    for (const listing of result.items) {
      entries.push({
        url: `${SITE_URL}/listing/${listing.slug}`,
        changeFrequency: 'weekly',
        priority: 0.7,
      });
    }
  } catch {
    // If platform API is unreachable, return static entries only
  }

  return entries;
}
