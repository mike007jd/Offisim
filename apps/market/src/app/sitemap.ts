import type { MetadataRoute } from 'next';
import { getRegistryClient } from '../lib/registry';
import { SITE_URL } from '../lib/url';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: new Date(), changeFrequency: 'daily', priority: 1.0 },
    { url: `${SITE_URL}/search`, changeFrequency: 'daily', priority: 0.8 },
  ];

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
