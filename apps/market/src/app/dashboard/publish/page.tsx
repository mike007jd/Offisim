'use client';

import { PublishWizard, useAuthContext } from '@aics/ui-market';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function PublishPage() {
  const { user, isLoading } = useAuthContext();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/dashboard');
    }
  }, [isLoading, user, router]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <span className="text-sm text-[var(--text-muted)]">Loading…</span>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl font-bold text-[var(--text-primary)]">
        New Listing
      </h1>
      <PublishWizard onComplete={() => router.push('/dashboard')} />
    </div>
  );
}
