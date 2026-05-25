import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { FieldRow } from '@/design-system/grammar/FieldRow.js';
import { SegmentedControl } from '@/design-system/grammar/SegmentedControl.js';
import { Select } from '@/design-system/grammar/Select.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { Input } from '@/design-system/primitives/input.js';
import { Switch } from '@/design-system/primitives/switch.js';
import { cn } from '@/lib/utils.js';
import { zodResolver } from '@hookform/resolvers/zod';
import { Cpu, Info, MonitorCog, Settings2, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

type SettingsTab = 'general' | 'provider' | 'runtime' | 'appearance' | 'about';

const NAV: ReadonlyArray<{ key: SettingsTab; label: string; icon: typeof Settings2 }> = [
  { key: 'general', label: 'General', icon: Settings2 },
  { key: 'provider', label: 'AI Provider', icon: Cpu },
  { key: 'runtime', label: 'Runtime', icon: MonitorCog },
  { key: 'appearance', label: 'Appearance', icon: SlidersHorizontal },
  { key: 'about', label: 'About', icon: Info },
];

const providerSchema = z.object({
  name: z.string().min(1, 'Required'),
  baseUrl: z.string().url('Enter a valid URL'),
  model: z.string().min(1, 'Required'),
  apiKey: z.string().min(8, 'Key looks too short'),
});
type ProviderForm = z.infer<typeof providerSchema>;

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="off-card-section">
      <CapsLabel>{title}</CapsLabel>
      <div className="off-card-section-body">{children}</div>
    </section>
  );
}

function ToggleRow({
  label,
  hint,
  defaultOn = false,
}: { label: string; hint: string; defaultOn?: boolean }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <div className="off-setting-row">
      <div className="off-setting-row-text">
        <span className="off-setting-row-label">{label}</span>
        <span className="off-setting-row-hint">{hint}</span>
      </div>
      <Switch checked={on} onCheckedChange={setOn} aria-label={label} />
    </div>
  );
}

function ProviderSection() {
  const form = useForm<ProviderForm>({
    resolver: zodResolver(providerSchema),
    defaultValues: {
      name: 'MiniMax Global',
      baseUrl: 'https://api.minimax.io/v1',
      model: 'MiniMax-M2.7',
      apiKey: '',
    },
  });

  const onSubmit = form.handleSubmit(() => {
    toast.success('Provider configuration saved');
  });

  return (
    <form onSubmit={onSubmit}>
      <SectionCard title="Active provider">
        <FieldRow
          label="Display name"
          hint={form.formState.errors.name?.message}
          warn={!!form.formState.errors.name}
        >
          {({ id }) => <Input id={id} {...form.register('name')} />}
        </FieldRow>
        <FieldRow
          label="Base URL"
          hint={form.formState.errors.baseUrl?.message}
          warn={!!form.formState.errors.baseUrl}
        >
          {({ id }) => <Input id={id} {...form.register('baseUrl')} />}
        </FieldRow>
        <FieldRow
          label="Model"
          hint={form.formState.errors.model?.message}
          warn={!!form.formState.errors.model}
        >
          {({ id }) => <Input id={id} {...form.register('model')} />}
        </FieldRow>
        <FieldRow
          label="API key"
          hint={
            form.formState.errors.apiKey?.message ?? 'Stored locally and never leaves this device.'
          }
          warn={!!form.formState.errors.apiKey}
        >
          {({ id }) => (
            <Input id={id} type="password" placeholder="••••••••" {...form.register('apiKey')} />
          )}
        </FieldRow>
        <div className="off-settings-actions">
          <Button type="button" variant="subtle" size="sm" onClick={() => form.reset()}>
            Reset
          </Button>
          <Button type="submit" size="sm">
            Save provider
          </Button>
        </div>
      </SectionCard>
    </form>
  );
}

export function SettingsSurface() {
  const [tab, setTab] = useState<SettingsTab>('general');
  const active = NAV.find((n) => n.key === tab);
  const activeLabel = active?.label ?? 'Settings';

  return (
    <div className="off-settings">
      <nav className="off-settings-nav" aria-label="Settings sections">
        <CapsLabel className="off-settings-nav-head">Settings</CapsLabel>
        {NAV.map((item) => (
          <button
            key={item.key}
            type="button"
            className={cn('off-focusable', item.key === tab && 'is-active')}
            onClick={() => setTab(item.key)}
          >
            <Icon icon={item.icon} size="sm" />
            {item.label}
          </button>
        ))}
      </nav>

      <div className="off-settings-scroll">
        <div className="off-settings-content">
          <div className="off-settings-pagehead">
            <span className="off-settings-pagetitle">{activeLabel}</span>
            <span className="off-settings-pagesub">
              Configure how Offisim behaves on this device.
            </span>
          </div>

          {tab === 'general' ? (
            <SectionCard title="Workspace">
              <ToggleRow
                label="Open last project on launch"
                hint="Restore the most recent company and project."
                defaultOn
              />
              <ToggleRow
                label="Confirm before destructive actions"
                hint="Ask before deleting employees, projects, or runs."
                defaultOn
              />
              <FieldRow label="Default run mode" hint="Applied to new conversations.">
                {({ id }) => (
                  <Select
                    id={id}
                    defaultValue="team"
                    options={[
                      { value: 'team', label: 'Team' },
                      { value: 'direct', label: 'Direct' },
                      { value: 'sop', label: 'Run SOP' },
                    ]}
                  />
                )}
              </FieldRow>
            </SectionCard>
          ) : null}

          {tab === 'provider' ? <ProviderSection /> : null}

          {tab === 'runtime' ? (
            <SectionCard title="Execution">
              <ToggleRow
                label="Sandbox file & shell tools"
                hint="Restrict tools to the bound workspace root."
                defaultOn
              />
              <ToggleRow
                label="Require approval for shell commands"
                hint="Pause runs before executing shell tools."
              />
              <FieldRow label="Max parallel employees" hint="Upper bound on concurrent runs.">
                {({ id }) => (
                  <Select
                    id={id}
                    defaultValue="3"
                    options={[
                      { value: '1', label: '1' },
                      { value: '3', label: '3' },
                      { value: '5', label: '5' },
                    ]}
                  />
                )}
              </FieldRow>
            </SectionCard>
          ) : null}

          {tab === 'appearance' ? (
            <SectionCard title="Density">
              <div className="off-setting-row">
                <div className="off-setting-row-text">
                  <span className="off-setting-row-label">Interface density</span>
                  <span className="off-setting-row-hint">
                    Compact is tuned for the game-HUD layout.
                  </span>
                </div>
                <SegmentedControl
                  options={[
                    { value: 'compact', label: 'Compact' },
                    { value: 'comfortable', label: 'Comfortable' },
                  ]}
                  value="compact"
                  onChange={() => {}}
                  ariaLabel="Density"
                />
              </div>
              <ToggleRow
                label="Reduce motion"
                hint="Honor the system reduced-motion preference."
                defaultOn
              />
            </SectionCard>
          ) : null}

          {tab === 'about' ? (
            <SectionCard title="Build">
              <div className="off-about-row">
                <span>Version</span>
                <span>0.8.0</span>
              </div>
              <div className="off-about-row">
                <span>Renderer</span>
                <span>React 19 · Tailwind v4</span>
              </div>
              <div className="off-about-row">
                <span>Runtime</span>
                <span>Tauri 2</span>
              </div>
            </SectionCard>
          ) : null}
        </div>
      </div>
    </div>
  );
}
