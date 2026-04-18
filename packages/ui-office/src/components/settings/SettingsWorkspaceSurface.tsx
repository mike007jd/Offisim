import { Tabs, TabsContent, TabsList, TabsTrigger } from '@offisim/ui-core';
import { Cpu } from 'lucide-react';
import { type ReactNode, useMemo } from 'react';
import type { ProviderConfig } from '../../lib/provider-config';
import { useTheme } from '../../theme';
import { McpConfigPanel } from './McpConfigPanel';
import { SettingsExternalTab } from './SettingsExternalTab';
import { SettingsProviderTab } from './SettingsProviderTab';
import { SettingsRuntimeTab } from './SettingsRuntimeTab';
import { assembleSettingsControllerApi } from './controller/assembleSettingsControllerApi';
import { useSettingsDirtyTracking } from './controller/useSettingsDirtyTracking';
import { useSettingsProviderState } from './controller/useSettingsProviderState';
import { useSettingsRuntimePolicy } from './controller/useSettingsRuntimePolicy';
import { useSettingsSaveOrchestrator } from './controller/useSettingsSaveOrchestrator';
import { MetricCard, SurfaceCard } from './settings-primitives';

export type SettingsTab = 'provider' | 'runtime' | 'mcp' | 'external';

interface SettingsWorkspaceControllerOptions {
  isActive: boolean;
  closeOnSave?: boolean;
  onDismiss: () => void;
  onSave: (config: ProviderConfig) => void;
  onSaveSuccess?: () => void;
  onToast?: (message: string, variant?: 'info' | 'success' | 'error') => void;
}

export function useSettingsWorkspaceController({
  isActive,
  closeOnSave = false,
  onDismiss,
  onSave,
  onSaveSuccess,
  onToast,
}: SettingsWorkspaceControllerOptions) {
  const { density, setDensity } = useTheme();
  const provider = useSettingsProviderState();
  const runtimePolicy = useSettingsRuntimePolicy();
  const snapshotJson = useMemo(
    () => JSON.stringify({ ...provider.snapshot, ...runtimePolicy.snapshot, density }),
    [provider.snapshot, runtimePolicy.snapshot, density],
  );
  const dirty = useSettingsDirtyTracking({ isActive, snapshotJson, onDismiss });
  const save = useSettingsSaveOrchestrator({
    isActive,
    closeOnSave,
    onDismiss,
    onSave,
    onSaveSuccess,
    provider,
    runtimePolicy,
    snapshotJson,
    markLoaded: dirty.markLoaded,
    resetLoadedSnapshot: dirty.resetLoadedSnapshot,
  });
  return assembleSettingsControllerApi({
    density,
    setDensity,
    provider,
    runtimePolicy,
    save,
    dirty,
    onToast,
  });
}

interface SettingsWorkspaceSurfaceProps {
  activeTab: SettingsTab;
  controller: ReturnType<typeof useSettingsWorkspaceController>;
  dismissControl: ReactNode;
  onActiveTabChange: (tab: SettingsTab) => void;
}

export function SettingsWorkspaceSurface({
  activeTab,
  controller,
  dismissControl,
  onActiveTabChange,
}: SettingsWorkspaceSurfaceProps) {
  const {
    baseURL,
    selectedCapabilities,
    selectedCompatibility,
    selectedPreset,
    selectedRegion,
    selectedSurface,
    selectedVendor,
  } = controller;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_top,#14203d_0%,#0b1121_42%,#040814_100%)] text-slate-100 shadow-[0_30px_120px_rgba(0,0,0,0.52)]">
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-b border-white/10 bg-slate-950/45 px-6 py-5 backdrop-blur-xl">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.36em] text-cyan-300/80">
                System Control
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">
                Provider Workspace
              </h1>
            </div>
            {dismissControl}
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Official compatibility"
              value={selectedCompatibility}
              detail={selectedPreset?.label ?? 'Custom'}
            />
            <MetricCard
              label="Surface"
              value={selectedSurface}
              detail={`Region: ${selectedRegion}`}
            />
            <MetricCard label="Capabilities" value={selectedCapabilities} detail="Preset-aware" />
            <MetricCard
              label="Endpoint"
              value={baseURL || selectedPreset?.defaults.baseURL || 'Manual'}
              detail={selectedVendor}
            />
          </div>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(value) => onActiveTabChange(value as SettingsTab)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="border-b border-white/10 bg-slate-950/25 px-6 py-4">
            <TabsList className="grid w-full grid-cols-2 rounded-full border border-white/10 bg-white/[0.03] p-1 md:grid-cols-4">
              <TabsTrigger
                value="provider"
                className="rounded-full px-4 py-2 text-sm data-[state=active]:bg-cyan-400/15 data-[state=active]:text-cyan-100"
              >
                Provider Workspace
              </TabsTrigger>
              <TabsTrigger
                value="runtime"
                className="rounded-full px-4 py-2 text-sm data-[state=active]:bg-cyan-400/15 data-[state=active]:text-cyan-100"
              >
                Runtime orchestration
              </TabsTrigger>
              <TabsTrigger
                value="mcp"
                className="rounded-full px-4 py-2 text-sm data-[state=active]:bg-cyan-400/15 data-[state=active]:text-cyan-100"
              >
                MCP servers
              </TabsTrigger>
              <TabsTrigger
                value="external"
                className="rounded-full px-4 py-2 text-sm data-[state=active]:bg-cyan-400/15 data-[state=active]:text-cyan-100"
              >
                External employees
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="provider" className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <SettingsProviderTab controller={controller} />
          </TabsContent>

          <TabsContent value="runtime" className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <SettingsRuntimeTab controller={controller} />
          </TabsContent>

          <TabsContent value="mcp" className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <SurfaceCard title="MCP servers" icon={<Cpu className="h-5 w-5" />}>
              <McpConfigPanel />
            </SurfaceCard>
          </TabsContent>

          <TabsContent value="external" className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <SettingsExternalTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
