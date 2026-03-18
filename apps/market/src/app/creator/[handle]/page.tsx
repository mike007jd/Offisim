export const revalidate = 300;

import type { CreatorProfile } from '@aics/registry-client';
import { ListingCard } from '@aics/ui-market';
import { Globe, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getRegistryClient } from '../../../lib/registry';
import { creatorJsonLd } from '../../../lib/jsonld';
import { SITE_URL } from '../../../lib/url';

interface Props {
  params: Promise<{ handle: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  try {
    const client = getRegistryClient();
    const creator = await client.getCreatorProfile(handle);
    const title = `${creator.display_name} (@${creator.handle})`;
    const description = creator.bio ?? `Creator profile for @${creator.handle}`;
    return {
      title,
      description,
      alternates: { canonical: `/creator/${handle}` },
      openGraph: {
        type: 'profile',
        title: `${title} — AICS Talent Market`,
        description,
        url: `${SITE_URL}/creator/${handle}`,
      },
      twitter: { card: 'summary', title, description },
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
    <div className="mx-auto max-w-content px-6 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(creatorJsonLd(creator)) }}
      />
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            {creator.display_name}
          </h1>
          {creator.verification_state === 'verified' && (
            <ShieldCheck size={20} className="text-blue-400" aria-label="Verified" />
          )}
          {creator.verification_state === 'trusted' && (
            <ShieldCheck size={20} className="text-emerald-400" aria-label="Trusted" />
          )}
        </div>
        <p className="mt-1 text-[var(--text-muted)]">@{creator.handle}</p>
        {creator.bio && (
          <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">{creator.bio}</p>
        )}
        {creator.website_url && (
          <a
            href={creator.website_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-sm text-[var(--accent-indigo)] hover:underline"
          >
            <Globe size={14} />
            {creator.website_url.replace(/^https?:\/\//, '')}
          </a>
        )}
      </div>

      <section>
        <h2 className="mb-5 font-display text-lg font-bold text-[var(--text-primary)]">
          Published Assets ({creator.listings.length})
        </h2>
        {creator.listings.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {creator.listings.map((listing) => (
              <ListingCard key={listing.listing_id} listing={listing} />
            ))}
          </div>
        ) : (
          <div className="card rounded-lg py-12 text-center">
            <p className="text-[var(--text-muted)]">No published assets yet.</p>
          </div>
        )}
      </section>
    </div>
  );
}
