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
import { FileImportTrigger } from '../install/FileImportTrigger.js';
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
  readonly onFileImport?: (file: File) => void;
  readonly variant?: 'default' | 'narrow';
}

const MANAGE_TABS = ['installed', 'updates', 'published'] as const;

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
        'market-filter-segmented',
        layout === 'sheet' && 'market-filter-segmented-sheet',
      )}
      items={options.map((opt): SegmentedControlItem<V> => {
        const Icon = opt.icon;
        return {
          value: opt.value,
          label: (
            <>
              {Icon && <Icon data-icon="segmented" aria-hidden="true" />}
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
  onFileImport,
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
        <>
          {onFileImport ? (
            <FileImportTrigger onFileSelect={onFileImport} compact={!narrow} />
          ) : null}
          <ToolbarButton onClick={onPublishClick} className="market-filter-publish">
            <CloudUpload data-icon="toolbar" aria-hidden="true" />
            Publish
          </ToolbarButton>
        </>
      )}
    </>
  );

  return (
    <div className="market-filter-bar">
      <div className="market-filter-main">
        <div className="market-filter-search">
          <Search data-icon="search" />
          <Input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search packages…"
            className="market-filter-search-input"
          />
        </div>

        {narrow ? (
          <ToolbarIconButton onClick={() => setSheetOpen(true)} aria-label="Open market filters">
            <SlidersHorizontal data-icon="toolbar" />
          </ToolbarIconButton>
        ) : (
          <div className="market-filter-controls">{controls}</div>
        )}
      </div>

      {narrowSheetOpen && (
        <div className="market-filter-sheet-scrim">
          <div ref={sheetRef} className="market-filter-sheet">
            <div className="market-filter-sheet-header">
              <div className="market-filter-sheet-title">Market filters</div>
              <ToolbarIconButton
                onClick={() => setSheetOpen(false)}
                shape="compact"
                aria-label="Close market filters"
              >
                <X data-icon="toolbar" />
              </ToolbarIconButton>
            </div>
            <div className="market-filter-sheet-controls">{controls}</div>
          </div>
        </div>
      )}

      {mode === 'manage' && (
        <div className="market-filter-subrow">
          <span className="market-filter-subrow-label">View</span>
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
        <ToolbarButton aria-label="Marketplace mode" className="market-filter-mode">
          <span>{mode === 'explore' ? 'Explore' : 'Manage'}</span>
          <ChevronDown data-icon="toolbar" />
        </ToolbarButton>
      }
      items={items}
      activeId={mode}
      onSelect={(id) => onModeChange(id as 'explore' | 'manage')}
      align="end"
      collisionPadding={8}
      contentClassName={cn('market-filter-mode-menu', inSheet && 'z-modal')}
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
        <ToolbarButton shape="compact" aria-label="Manage view" className="market-filter-manage">
          <Layers data-icon="toolbar" />
          <span>{current}</span>
          <ChevronDown data-icon="toolbar" />
        </ToolbarButton>
      }
      items={items}
      activeId={manageTab}
      onSelect={(id) => onManageTabChange(id as 'installed' | 'updates' | 'published')}
      align="start"
      collisionPadding={8}
      contentClassName="market-filter-mode-menu"
    />
  );
}
