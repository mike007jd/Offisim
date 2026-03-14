'use client';

import { useAuthContext, LoginDialog } from '@aics/ui-market';
import { useState } from 'react';

export function MarketNav() {
  const { user, logout } = useAuthContext();
  const [showLogin, setShowLogin] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--bg-base)]/80 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-content items-center justify-between px-6 py-3">
          <a href="/" className="flex items-center gap-2 group">
            <span className="font-display text-xl font-bold tracking-tight text-[var(--text-primary)] group-hover:text-[var(--accent-indigo)] transition-colors">
              AICS
            </span>
            <span className="text-sm font-medium text-[var(--text-muted)]">Talent Market</span>
          </a>
          <div className="flex items-center gap-5">
            <a
              href="/search"
              className="text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              Browse
            </a>
            {user ? (
              <>
                <a
                  href="/dashboard"
                  className="text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  Dashboard
                </a>
                <div className="flex items-center gap-3 pl-2 border-l border-[var(--border)]">
                  <span className="text-xs text-[var(--text-muted)]">{user.displayName}</span>
                  <button
                    type="button"
                    onClick={logout}
                    className="text-xs text-[var(--text-muted)] hover:text-[var(--accent-rose)] transition-colors"
                  >
                    Logout
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setShowLogin(true)}
                className="rounded-lg bg-[var(--accent-indigo)] px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-400 transition-colors"
              >
                Sign In
              </button>
            )}
          </div>
        </nav>
      </header>
      {showLogin && <LoginDialog onClose={() => setShowLogin(false)} />}
    </>
  );
}
