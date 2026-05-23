import type { AssetKind } from '@offisim/asset-schema';
import {
  EntityDropdown,
  type EntityDropdownItem,
  Input,
  SegmentedControl,
  type SegmentedControlItem,
  ToolbarButton,
  ToolbarIconButton,
  cn,
  useFocusTrap,
  useRegisterModal,
  useTopmostEscape,
} from '@offisim/ui-core';
import {
  Book,
  Box,
  Building2,
  ChevronDown,
  CloudUpload,
  Layers,
  LayoutGrid,
  type LucideIcon,
  Search,
  SlidersHorizontal,
  UserPlus,
  X,
  Zap,
} from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
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
const FILTER_ICON_CLASS = 'size-3 shrink-0 text-ink-4';

const KIND_FILTER_ICON: Partial<Record<AssetKind | 'all', LucideIcon>> = {
  employee: UserPlus,
  skill: Zap,
  sop: Book,
  company_template: Building2,
  office_layout: LayoutGrid,
  prefab: Box,
};

interface SegmentedOption<V extends string> {
  value: V;
  label: string;
  icon?: LucideIcon;
}

function Segmented<V extends string>({
  ariaLabel,
  value,
  options,
  onChange,
  layout = 'bar',
}: {
  ariaLabel: string;
  value: V;
  options: ReadonlyArray<SegmentedOption<V>>;
  onChange: (value: V) => void;
  layout?: 'bar' | 'sheet';
}) {
  return (
    <SegmentedControl
      ariaLabel={ariaLabel}
      value={value}
      onChange={onChange}
      size="sm"
      layout={layout === 'sheet' ? 'scroll' : 'default'}
      className={cn(
        'rounded-r-md border-line bg-surface-2 shadow-elev-1',
        layout === 'sheet' && 'w-full justify-start',
      )}
      items={options.map((opt): SegmentedControlItem<V> => {
        const Icon = opt.icon;
        return {
          value: opt.value,
          label: (
            <>
              {Icon && <Icon className="size-3" aria-hidden="true" />}
              {opt.label}
            </>
          ),
        };
      })}
    />
  );
}

const KIND_OPTIONS: ReadonlyArray<SegmentedOption<AssetKind | 'all'>> = KIND_FILTERS.map((f) => ({
  value: f.value,
  label: f.label,
  icon: KIND_FILTER_ICON[f.value],
}));

const SORT_OPTION_LIST: ReadonlyArray<SegmentedOption<MarketSortOption>> = SORT_OPTIONS.map(
  (s) => ({
    value: s,
    label: s.charAt(0).toUpperCase() + s.slice(1),
  }),
);

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
  const segmentedLayout = narrow ? 'sheet' : 'bar';

  const controls: ReactNode = (
    <>
      {mode === 'explore' && (
        <Segmented
          ariaLabel="Kind filter"
          value={kind}
          options={KIND_OPTIONS}
          onChange={onKindChange}
          layout={segmentedLayout}
        />
      )}

      {mode === 'explore' && (
        <Segmented
          ariaLabel="Sort"
          value={sort}
          options={SORT_OPTION_LIST}
          onChange={onSortChange}
          layout={segmentedLayout}
        />
      )}

      <ModeDropdown mode={mode} onModeChange={onModeChange} inSheet={narrow} />

      {mode === 'explore' && (
        <ToolbarButton onClick={onPublishClick} className="text-ink-2">
          <CloudUpload className={FILTER_ICON_CLASS} aria-hidden="true" />
          Publish
        </ToolbarButton>
      )}
    </>
  );

  return (
    <div className="shrink-0 border-b border-line bg-surface-1">
      <div className="flex h-14 items-center gap-3 px-sp-7">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-4" />
          <Input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search packages…"
            className="h-8 w-full rounded-r-md border-line bg-surface-2 pl-9 text-fs-sm text-ink-1 placeholder:text-ink-4 focus:border-accent"
          />
        </div>

        {narrow ? (
          <ToolbarIconButton onClick={() => setSheetOpen(true)} aria-label="Open market filters">
            <SlidersHorizontal className="size-4" />
          </ToolbarIconButton>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-3">{controls}</div>
        )}
      </div>

      {narrowSheetOpen && (
        <div className="fixed inset-0 z-modal flex items-end bg-glass-bg">
          <div
            ref={sheetRef}
            className="w-full rounded-t-r-lg border-t border-line bg-surface-1 p-4 shadow-elev-2"
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="text-fs-sm font-semibold text-ink-1">Market filters</div>
              <ToolbarIconButton
                onClick={() => setSheetOpen(false)}
                shape="compact"
                aria-label="Close market filters"
              >
                <X className="size-4" />
              </ToolbarIconButton>
            </div>
            <div className="flex min-w-0 flex-col gap-3 overflow-hidden">{controls}</div>
          </div>
        </div>
      )}

      {mode === 'manage' && (
        <div className="flex items-center gap-2 px-sp-7 pb-2">
          <span className="text-fs-micro font-semibold uppercase tracking-wide text-ink-3">
            View
          </span>
          <ManageTabDropdown manageTab={manageTab} onManageTabChange={onManageTabChange} />
        </div>
      )}
    </div>
  );
}

function ModeDropdown({
  mode,
  onModeChange,
  inSheet,
}: {
  mode: 'explore' | 'manage';
  onModeChange: (mode: 'explore' | 'manage') => void;
  inSheet: boolean;
}) {
  const items: EntityDropdownItem[] = [
    { id: 'explore', label: 'Explore' },
    { id: 'manage', label: 'Manage' },
  ];
  return (
    <EntityDropdown
      trigger={
        <ToolbarButton aria-label="Marketplace mode">
          <span>{mode === 'explore' ? 'Explore' : 'Manage'}</span>
          <ChevronDown className={FILTER_ICON_CLASS} />
        </ToolbarButton>
      }
      items={items}
      activeId={mode}
      onSelect={(id) => onModeChange(id as 'explore' | 'manage')}
      align="end"
      collisionPadding={8}
      contentClassName={cn('w-44', inSheet && 'z-modal')}
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
        <ToolbarButton shape="compact" aria-label="Manage view">
          <Layers className={FILTER_ICON_CLASS} />
          <span>{current}</span>
          <ChevronDown className={FILTER_ICON_CLASS} />
        </ToolbarButton>
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
