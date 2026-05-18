import type { AssetKind } from '@offisim/asset-schema';
import {
  Button,
  EntityDropdown,
  type EntityDropdownItem,
  Input,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useFocusTrap,
  useRegisterModal,
  useTopmostEscape,
} from '@offisim/ui-core';
import { ChevronDown, Layers, Search, SlidersHorizontal, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { KIND_FILTERS, type MarketSortOption, SORT_OPTIONS } from './marketplace-meta.js';

export interface MarketFilterBarProps {
  readonly mode: 'explore' | 'manage';
  readonly search: string;
  readonly sort: MarketSortOption;
  readonly kind: AssetKind | 'all';
  readonly manageTab: 'installed' | 'updates' | 'published';
  readonly onModeChange: (mode: 'explore' | 'manage') => void;
  readonly onSearchChange: (search: string) => void;
  readonly onSortChange: (sort: MarketSortOption) => void;
  readonly onKindChange: (kind: AssetKind | 'all') => void;
  readonly onManageTabChange: (tab: 'installed' | 'updates' | 'published') => void;
  readonly onPublishClick: () => void;
  readonly variant?: 'default' | 'narrow';
}

const MANAGE_TABS = ['installed', 'updates', 'published'] as const;

export function MarketFilterBar({
  mode,
  search,
  sort,
  kind,
  manageTab,
  onModeChange,
  onSearchChange,
  onSortChange,
  onKindChange,
  onManageTabChange,
  onPublishClick,
  variant = 'default',
}: MarketFilterBarProps) {
  const sheetStackId = 'market-filter-sheet';
  const sheetRef = useRef<HTMLDivElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const narrow = variant === 'narrow';
  const narrowSheetOpen = narrow && sheetOpen;

  useRegisterModal(narrowSheetOpen ? sheetStackId : null, 'overlay');
  useTopmostEscape(narrowSheetOpen ? sheetStackId : null, () => setSheetOpen(false), {
    enabled: narrowSheetOpen,
  });
  useFocusTrap(sheetRef, narrowSheetOpen);

  const controls = (
    <>
      {/* Kind filter — explore only */}
      {mode === 'explore' && (
        <Select value={kind} onValueChange={(value) => onKindChange(value as AssetKind | 'all')}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {KIND_FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}

      {/* Sort — explore only */}
      {mode === 'explore' && (
        <Select value={sort} onValueChange={(value) => onSortChange(value as MarketSortOption)}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {SORT_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}

      {/* Mode toggle */}
      <ModeDropdown mode={mode} onModeChange={onModeChange} />

      {/* Publish — explore only */}
      {mode === 'explore' && (
        <Button
          type="button"
          onClick={onPublishClick}
          variant="outline"
          className="h-9 px-4 text-sm font-medium text-text-secondary hover:text-text-primary"
        >
          Publish
        </Button>
      )}
    </>
  );

  return (
    <div className="shrink-0 border-b border-border-default bg-surface">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <Input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search packages..."
            className="h-9 w-full border-border-default bg-surface pl-9 text-sm text-text-primary placeholder:text-text-muted focus:border-border-focus"
          />
        </div>

        {narrow ? (
          <Button
            type="button"
            onClick={() => setSheetOpen(true)}
            variant="outline"
            size="icon"
            className="size-9 shrink-0 text-text-secondary"
            aria-label="Open market filters"
          >
            <SlidersHorizontal className="size-4" />
          </Button>
        ) : (
          controls
        )}
      </div>

      {sheetOpen && narrow && (
        <div className="fixed inset-0 z-modal flex items-end bg-glass-bg">
          <div
            ref={sheetRef}
            className="w-full rounded-t-2xl border-t border-border-default bg-surface-elevated p-4 shadow-modal"
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="text-sm font-semibold text-text-primary">Market filters</div>
              <Button
                type="button"
                onClick={() => setSheetOpen(false)}
                variant="outline"
                size="icon"
                className="size-8 text-text-secondary"
                aria-label="Close market filters"
              >
                <X className="size-4" />
              </Button>
            </div>
            <div className="grid gap-3">{controls}</div>
          </div>
        </div>
      )}

      {/* Manage sub-tabs */}
      {mode === 'manage' && (
        <div className="flex items-center gap-2 px-6 pb-2">
          <span className="text-xs uppercase tracking-wider text-text-muted">View</span>
          <ManageTabDropdown manageTab={manageTab} onManageTabChange={onManageTabChange} />
        </div>
      )}
    </div>
  );
}

function ModeDropdown({
  mode,
  onModeChange,
}: {
  mode: 'explore' | 'manage';
  onModeChange: (mode: 'explore' | 'manage') => void;
}) {
  const items: EntityDropdownItem[] = [
    { id: 'explore', label: 'Explore' },
    { id: 'manage', label: 'Manage' },
  ];
  return (
    <EntityDropdown
      trigger={
        <Button
          type="button"
          variant="outline"
          className="h-9 gap-2 px-3 text-sm text-text-primary"
          aria-label="Marketplace mode"
        >
          <span className="font-medium">{mode === 'explore' ? 'Explore' : 'Manage'}</span>
          <ChevronDown className="size-3 shrink-0 text-text-muted" />
        </Button>
      }
      items={items}
      activeId={mode}
      onSelect={(id) => onModeChange(id as 'explore' | 'manage')}
      align="end"
      collisionPadding={8}
      contentClassName="w-44"
    />
  );
}

function ManageTabDropdown({
  manageTab,
  onManageTabChange,
}: {
  manageTab: 'installed' | 'updates' | 'published';
  onManageTabChange: (tab: 'installed' | 'updates' | 'published') => void;
}) {
  const items: EntityDropdownItem[] = MANAGE_TABS.map((tab) => ({
    id: tab,
    label: tab.charAt(0).toUpperCase() + tab.slice(1),
  }));
  const current = manageTab.charAt(0).toUpperCase() + manageTab.slice(1);
  return (
    <EntityDropdown
      trigger={
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-2 px-2.5 text-xs text-text-primary"
          aria-label="Manage view"
        >
          <Layers className="size-3 shrink-0 text-text-muted" />
          <span className="font-medium">{current}</span>
          <ChevronDown className="size-3 shrink-0 text-text-muted" />
        </Button>
      }
      items={items}
      activeId={manageTab}
      onSelect={(id) => onManageTabChange(id as 'installed' | 'updates' | 'published')}
      align="start"
      collisionPadding={8}
      contentClassName="w-44"
    />
  );
}
