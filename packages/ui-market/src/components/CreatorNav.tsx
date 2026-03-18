'use client';

import { Clock, LayoutDashboard, PlusCircle, Settings, User } from 'lucide-react';

export interface CreatorNavProps {
  displayName: string;
  handle: string;
  activePath?: string;
  onLogout: () => void;
}

interface NavLinkProps {
  href: string;
  label: string;
  icon: React.ReactNode;
  active?: boolean;
}

function NavLink({ href, label, icon, active }: NavLinkProps) {
  return (
    <a
      href={href}
      className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? 'bg-blue-50 text-blue-700'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
      }`}
    >
      {icon}
      {label}
    </a>
  );
}

export function CreatorNav({ displayName, handle, activePath, onLogout }: CreatorNavProps) {
  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-6">
      <div className="mb-6">
        <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{displayName}</p>
        <p className="truncate text-xs text-[var(--text-muted)]">@{handle}</p>
      </div>

      <nav className="flex flex-col gap-1">
        <NavLink
          href="/dashboard"
          label="Dashboard"
          icon={<LayoutDashboard size={16} />}
          active={activePath === '/dashboard'}
        />
        <NavLink
          href="/dashboard/publish"
          label="New Listing"
          icon={<PlusCircle size={16} />}
          active={activePath === '/dashboard/publish'}
        />
        <NavLink
          href="/dashboard/history"
          label="History"
          icon={<Clock size={16} />}
          active={activePath === '/dashboard/history'}
        />
        <NavLink
          href={`/creator/${handle}`}
          label="Profile"
          icon={<User size={16} />}
          active={activePath === `/creator/${handle}`}
        />
        <NavLink
          href="/dashboard/settings"
          label="Settings"
          icon={<Settings size={16} />}
          active={activePath === '/dashboard/settings'}
        />
      </nav>

      <div className="mt-auto">
        <button
          type="button"
          onClick={onLogout}
          className="w-full rounded-md px-3 py-2 text-left text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)]"
        >
          Logout
        </button>
      </div>
    </aside>
  );
}
