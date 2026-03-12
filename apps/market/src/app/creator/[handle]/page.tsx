import type { CreatorProfile } from '@aics/registry-client';
import { Globe, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ListingCard } from '../../../components/ListingCard';
import { getRegistryClient } from '../../../lib/registry';

interface Props {
  params: Promise<{ handle: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  try {
    const client = getRegistryClient();
    const creator = await client.getCreatorProfile(handle);
    return {
      title: `${creator.display_name} (@${creator.handle})`,
      description: creator.bio ?? `Creator profile for @${creator.handle}`,
    };
  } catch {
    return { title: 'Creator Not Found' };
  }
}

export default async function CreatorPage({ params }: Props) {
  const { handle } = await params;
  const client = getRegistryClient();

  let creator: CreatorProfile;
  try {
    creator = await client.getCreatorProfile(handle);
  } catch {
    notFound();
  }

  return (
    <div className="mx-auto max-w-content px-6 py-8">
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{creator.display_name}</h1>
          {creator.verification_state === 'verified' && (
            <ShieldCheck size={20} className="text-blue-500" aria-label="Verified" />
          )}
          {creator.verification_state === 'trusted' && (
            <ShieldCheck size={20} className="text-green-500" aria-label="Trusted" />
          )}
        </div>
        <p className="mt-1 text-gray-500">@{creator.handle}</p>
        {creator.bio && <p className="mt-2 text-gray-700">{creator.bio}</p>}
        {creator.website_url && (
          <a
            href={creator.website_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
          >
            <Globe size={14} />
            {creator.website_url.replace(/^https?:\/\//, '')}
          </a>
        )}
      </div>

      <section>
        <h2 className="mb-4 text-lg font-semibold text-gray-900">
          Published Assets ({creator.listings.length})
        </h2>
        {creator.listings.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {creator.listings.map((listing) => (
              <ListingCard key={listing.listing_id} listing={listing} />
            ))}
          </div>
        ) : (
          <p className="text-gray-500">No published assets yet.</p>
        )}
      </section>
    </div>
  );
}
