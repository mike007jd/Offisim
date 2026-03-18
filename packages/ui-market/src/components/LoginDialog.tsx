'use client';

import { useState } from 'react';
import { useAuth } from '../hooks/useAuth.js';

interface Props {
  onClose?: () => void;
}

type Mode = 'sign-in' | 'sign-up';

export function LoginDialog({ onClose }: Props) {
  const { login, register, loginWithGithub, loginWithGoogle } = useAuth();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      if (mode === 'sign-in') {
        await login(email.trim(), password);
      } else {
        await register(email.trim(), password, displayName.trim());
      }
      onClose?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSocial(provider: 'github' | 'google') {
    setError(null);
    setIsLoading(true);
    try {
      if (provider === 'github') {
        await loginWithGithub();
      } else {
        await loginWithGoogle();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Social login failed');
      setIsLoading(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-sm rounded-lg bg-[var(--bg-secondary)] p-6 shadow-none border border-[var(--border-bright)]">
        <div className="mb-4 flex items-start justify-between">
          <h2 id="login-dialog-title" className="text-lg font-semibold text-[var(--text-primary)]">
            {mode === 'sign-in' ? 'Sign in to AICS Market' : 'Create an Account'}
          </h2>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="ml-4 rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)]"
            >
              ✕
            </button>
          )}
        </div>

        {/* Social login buttons */}
        <div className="mb-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => handleSocial('github')}
            disabled={isLoading}
            className="flex items-center justify-center gap-2 rounded-md border border-[var(--border-bright)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
            Continue with GitHub
          </button>
          <button
            type="button"
            onClick={() => handleSocial('google')}
            disabled={isLoading}
            className="flex items-center justify-center gap-2 rounded-md border border-[var(--border-bright)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Continue with Google
          </button>
        </div>

        <div className="relative mb-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-[var(--border-bright)]" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="bg-[var(--bg-secondary)] px-2 text-[var(--text-muted)]">or</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {mode === 'sign-up' && (
            <div>
              <label htmlFor="login-display-name" className="mb-1 block text-sm font-medium text-[var(--text-secondary)]">
                Display name
              </label>
              <input
                id="login-display-name"
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                disabled={isLoading}
                className="w-full rounded-md border border-[var(--border-bright)] px-3 py-2 text-sm placeholder-[var(--text-muted)] focus:border-[var(--accent-indigo)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-indigo)] disabled:opacity-50"
              />
            </div>
          )}

          <div>
            <label htmlFor="login-email" className="mb-1 block text-sm font-medium text-[var(--text-secondary)]">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={isLoading}
              className="w-full rounded-md border border-[var(--border-bright)] px-3 py-2 text-sm placeholder-[var(--text-muted)] focus:border-[var(--accent-indigo)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-indigo)] disabled:opacity-50"
            />
          </div>

          <div>
            <label htmlFor="login-password" className="mb-1 block text-sm font-medium text-[var(--text-secondary)]">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 8 characters"
              disabled={isLoading}
              className="w-full rounded-md border border-[var(--border-bright)] px-3 py-2 text-sm placeholder-[var(--text-muted)] focus:border-[var(--accent-indigo)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-indigo)] disabled:opacity-50"
            />
          </div>

          {error && (
            <p role="alert" className="rounded-md bg-[var(--accent-rose)]/10 px-3 py-2 text-sm text-[var(--accent-rose)]">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isLoading || !email.trim() || !password}
            className="rounded-md bg-[var(--accent-indigo)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading
              ? mode === 'sign-in'
                ? 'Signing in...'
                : 'Creating account...'
              : mode === 'sign-in'
                ? 'Sign in'
                : 'Create account'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-[var(--text-muted)]">
          {mode === 'sign-in' ? (
            <>
              Don't have an account?{' '}
              <button
                type="button"
                onClick={() => {
                  setMode('sign-up');
                  setError(null);
                }}
                className="text-[var(--accent-indigo)] hover:underline"
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => {
                  setMode('sign-in');
                  setError(null);
                }}
                className="text-[var(--accent-indigo)] hover:underline"
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
