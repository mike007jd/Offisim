'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuthContext, PLATFORM_API_URL } from '@aics/ui-market';

interface ApiToken {
  token_id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export default function SettingsPage() {
  const { user, isLoading: authLoading } = useAuthContext();
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(true);

  // Create token form
  const [name, setName] = useState('');
  const [expiresInDays, setExpiresInDays] = useState<number | ''>('');
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchTokens = useCallback(async () => {
    try {
      const res = await fetch(`${PLATFORM_API_URL}/v1/auth/tokens`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = (await res.json()) as { tokens: ApiToken[] };
        setTokens(data.tokens);
      }
    } catch {
      // Ignore errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && user) {
      fetchTokens();
    } else {
      setLoading(false);
    }
  }, [authLoading, user, fetchTokens]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    setNewToken(null);

    try {
      const res = await fetch(`${PLATFORM_API_URL}/v1/auth/tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: name.trim(),
          expires_in_days: expiresInDays || undefined,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? 'Failed to create token');
      }

      const data = (await res.json()) as { token: string };
      setNewToken(data.token);
      setName('');
      setExpiresInDays('');
      await fetchTokens();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create token');
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(tokenId: string) {
    if (!confirm('Are you sure you want to revoke this token? This cannot be undone.')) return;

    try {
      await fetch(`${PLATFORM_API_URL}/v1/auth/tokens/${tokenId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      setTokens((prev) => prev.filter((t) => t.token_id !== tokenId));
    } catch {
      // Ignore
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <span className="text-sm text-gray-400">Loading...</span>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">Manage your API tokens for CLI and programmatic access.</p>
      </div>

      {/* Create new token */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Create API Token</h2>
        <form onSubmit={handleCreate} className="flex flex-col gap-3 max-w-md">
          <div>
            <label htmlFor="token-name" className="mb-1 block text-sm font-medium text-gray-700">
              Token name
            </label>
            <input
              id="token-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. CI/CD, CLI"
              disabled={creating}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
            />
          </div>
          <div>
            <label htmlFor="token-expires" className="mb-1 block text-sm font-medium text-gray-700">
              Expires in (days, optional)
            </label>
            <input
              id="token-expires"
              type="number"
              min={1}
              max={365}
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value ? Number(e.target.value) : '')}
              placeholder="Leave empty for no expiry"
              disabled={creating}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
            />
          </div>
          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={creating || !name.trim()}
            className="w-fit rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Create Token'}
          </button>
        </form>

        {newToken && (
          <div className="mt-4 max-w-md rounded-md border border-green-200 bg-green-50 p-4">
            <p className="mb-2 text-sm font-medium text-green-800">
              Token created. Copy it now -- you will not be able to see it again.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-white px-3 py-2 text-xs font-mono text-gray-900 border border-green-200 break-all">
                {newToken}
              </code>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(newToken)}
                className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
              >
                Copy
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Token list */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Active Tokens</h2>
        {tokens.length === 0 ? (
          <p className="text-sm text-gray-500">No API tokens yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-500">
                  <th className="pb-2 font-medium">Name</th>
                  <th className="pb-2 font-medium">Prefix</th>
                  <th className="pb-2 font-medium">Created</th>
                  <th className="pb-2 font-medium">Last used</th>
                  <th className="pb-2 font-medium">Expires</th>
                  <th className="pb-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => (
                  <tr key={t.token_id} className="border-b border-gray-100">
                    <td className="py-2 pr-4 font-medium text-gray-900">{t.name}</td>
                    <td className="py-2 pr-4">
                      <code className="text-xs text-gray-600">{t.token_prefix}...</code>
                    </td>
                    <td className="py-2 pr-4 text-gray-500">
                      {new Date(t.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-2 pr-4 text-gray-500">
                      {t.last_used_at ? new Date(t.last_used_at).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="py-2 pr-4 text-gray-500">
                      {t.expires_at ? new Date(t.expires_at).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => handleRevoke(t.token_id)}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
