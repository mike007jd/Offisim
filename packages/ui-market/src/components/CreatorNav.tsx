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
          : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
      }`}
    >
      {icon}
      {label}
    </a>
  );
}

export function CreatorNav({ displayName, handle, activePath, onLogout }: CreatorNavProps) {
  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-gray-200 bg-white px-4 py-6">
      <div className="mb-6">
        <p className="truncate text-sm font-semibold text-gray-900">{displayName}</p>
        <p className="truncate text-xs text-gray-500">@{handle}</p>
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
          className="w-full rounded-md px-3 py-2 text-left text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700"
        >
          Logout
        </button>
      </div>
    </aside>
  );
}
