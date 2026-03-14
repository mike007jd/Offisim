'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { PublishWizard, useAuthContext } from '@aics/ui-market';

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
        <span className="text-sm text-gray-400">Loading…</span>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">New Listing</h1>
      <PublishWizard onComplete={() => router.push('/dashboard')} />
    </div>
  );
}
