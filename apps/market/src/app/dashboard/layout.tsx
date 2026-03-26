'use client';

import { RegistryClient } from '@aics/registry-client';
import type { MyCreatorProfile } from '@aics/registry-client';
import { CreatorNav, LoginDialog, PLATFORM_API_URL, useAuthContext } from '@aics/ui-market';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading, logout, registerCreator } = useAuthContext();
  const pathname = usePathname();

  const [creatorProfile, setCreatorProfile] = useState<MyCreatorProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Register creator form state
  const [handle, setHandle] = useState('');
  const [bio, setBio] = useState('');
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

  // Fetch creator profile once authenticated
  useEffect(() => {
    if (!user) {
      setCreatorProfile(null);
      return;
    }
    setProfileLoading(true);
    new RegistryClient({ baseUrl: PLATFORM_API_URL, credentials: 'include' })
      .getMyCreatorProfile()
      .then((data) => {
        setCreatorProfile(data.creator);
      })
      .catch(() => {
        setProfileError('Failed to load creator profile.');
      })
      .finally(() => setProfileLoading(false));
  }, [user]);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setRegisterError(null);
    setRegistering(true);
    try {
      await registerCreator(
        handle.trim(),
        user?.displayName ?? handle.trim(),
        bio.trim() || undefined,
      );
      // Re-fetch profile after registration
      const data = await new RegistryClient({
        baseUrl: PLATFORM_API_URL,
        credentials: 'include',
      }).getMyCreatorProfile();
      setCreatorProfile(data.creator);
    } catch (err) {
      setRegisterError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setRegistering(false);
    }
  }

  // Show login overlay if not authenticated
  if (!isLoading && !user) {
    return (
      <div className="relative min-h-[60vh]">
        <div className="flex items-center justify-center py-24 text-[var(--text-muted)]">
          Sign in to access your creator dashboard.
        </div>
        <LoginDialog />
      </div>
    );
  }

  // Still loading auth or profile
  if (isLoading || profileLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <span className="text-sm text-[var(--text-muted)]">Loading...</span>
      </div>
    );
  }

  if (profileError) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-sm text-red-500">{profileError}</p>
      </div>
    );
  }

  // Logged in but not a creator — show registration form
  if (user && !creatorProfile) {
    return (
      <div className="mx-auto max-w-sm py-16">
        <h1 className="mb-2 text-xl font-bold text-[var(--text-primary)]">Become a Creator</h1>
        <p className="mb-6 text-sm text-[var(--text-muted)]">
          Register a creator profile to publish listings on the Offisim marketplace.
        </p>
        <form onSubmit={handleRegister} className="flex flex-col gap-4">
          <div>
            <label
              htmlFor="creator-handle"
              className="mb-1 block text-sm font-medium text-[var(--text-secondary)]"
            >
              Handle
            </label>
            <input
              id="creator-handle"
              type="text"
              required
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="your-handle"
              disabled={registering}
              className="w-full rounded-md border border-[var(--border-bright)] px-3 py-2 text-sm placeholder-[var(--text-muted)] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
            />
          </div>
          <div>
            <label
              htmlFor="creator-bio"
              className="mb-1 block text-sm font-medium text-[var(--text-secondary)]"
            >
              Bio (optional)
            </label>
            <textarea
              id="creator-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell the community about yourself..."
              rows={3}
              disabled={registering}
              className="w-full rounded-md border border-[var(--border-bright)] px-3 py-2 text-sm placeholder-[var(--text-muted)] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
            />
          </div>
          {registerError && (
            <p role="alert" className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {registerError}
            </p>
          )}
          <button
            type="submit"
            disabled={registering || !handle.trim()}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {registering ? 'Registering...' : 'Register as Creator'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      {creatorProfile && (
        <CreatorNav
          displayName={creatorProfile.display_name}
          handle={creatorProfile.handle}
          activePath={pathname}
          onLogout={logout}
        />
      )}
      <main className="min-w-0 flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
