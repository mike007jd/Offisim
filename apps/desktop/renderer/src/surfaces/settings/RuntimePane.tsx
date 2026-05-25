import {
  CapsLabel,
  CardBlock,
  FieldRow,
  SegmentedControl,
  Select,
} from '@/design-system/grammar/index.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { Input } from '@/design-system/primitives/input.js';
import {
  Check,
  Download,
  FolderOpen,
  Info,
  Monitor,
  Moon,
  Package,
  Sun,
  Unlink,
  Zap,
} from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import {
  DEFAULT_RUNTIME_OPTIONS,
  type DensityValue,
  ENABLED_OPTIONS,
  EXECUTION_MODE_OPTIONS,
  HARNESS_CONTROL,
  RUNTIME_BINDING_OPTIONS,
  type RuntimeBindingValue,
  type RuntimeFormValues,
  SCENE_DIAGNOSTIC,
  type ThemeValue,
  VAULT_STATUS,
} from './settings-data.js';

interface RuntimePaneProps {
  form: UseFormReturn<RuntimeFormValues>;
  theme: ThemeValue;
  density: DensityValue;
  onThemeChange: (value: ThemeValue) => void;
  onDensityChange: (value: DensityValue) => void;
}

export function RuntimePane({
  form,
  theme,
  density,
  onThemeChange,
  onDensityChange,
}: RuntimePaneProps) {
  const binding = form.watch('runtimeBinding') as RuntimeBindingValue;
  const errors = form.formState.errors;

  return (
    <div className="off-set-pane">
      <div className="off-set-panehead">
        <div className="off-set-panetitle">Runtime</div>
        <div className="off-set-panedesc">
          How agents execute — runtime defaults, appearance, the main harness owner, conversation
          memory, the local vault, and scene diagnostics.
        </div>
      </div>

      {/* Runtime defaults */}
      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <CapsLabel>Runtime defaults</CapsLabel>
        </div>
        <CardBlock>
          <div className="off-set-grid-3">
            <FieldRow label="Execution mode">
              {({ id }) => (
                <Select
                  id={id}
                  options={EXECUTION_MODE_OPTIONS}
                  {...form.register('executionMode')}
                />
              )}
            </FieldRow>
            <FieldRow label="Tool search">
              {({ id }) => (
                <Select id={id} options={ENABLED_OPTIONS} {...form.register('toolSearch')} />
              )}
            </FieldRow>
            <FieldRow label="Git auto-commit">
              {({ id }) => (
                <Select id={id} options={ENABLED_OPTIONS} {...form.register('gitAutoCommit')} />
              )}
            </FieldRow>
            <FieldRow className="off-set-span-2" label="Default employee runtime">
              {({ id }) => (
                <Select
                  id={id}
                  options={DEFAULT_RUNTIME_OPTIONS}
                  {...form.register('defaultRuntime')}
                />
              )}
            </FieldRow>
          </div>
        </CardBlock>
      </section>

      {/* Appearance */}
      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <CapsLabel>Appearance</CapsLabel>
        </div>
        <CardBlock>
          <div className="off-set-grid-2">
            <div className="off-field">
              <span className="off-field-label">Theme</span>
              <SegmentedControl<ThemeValue>
                value={theme}
                onChange={onThemeChange}
                ariaLabel="Theme"
                options={[
                  { value: 'system', label: 'System', icon: <Icon icon={Monitor} size="sm" /> },
                  { value: 'light', label: 'Light', icon: <Icon icon={Sun} size="sm" /> },
                  { value: 'dark', label: 'Dark', icon: <Icon icon={Moon} size="sm" /> },
                ]}
              />
              <span className="off-field-hint">
                {theme === 'system' ? 'Following OS preference: Light' : `Forcing ${theme} theme`}
              </span>
            </div>
            <div className="off-field">
              <span className="off-field-label">Display density</span>
              <SegmentedControl<DensityValue>
                value={density}
                onChange={onDensityChange}
                ariaLabel="Display density"
                options={[
                  { value: 'compact', label: 'Compact' },
                  { value: 'normal', label: 'Normal' },
                  { value: 'spacious', label: 'Spacious' },
                ]}
              />
              <span className="off-field-hint">
                Compact tightens row padding; Spacious does the inverse. Applied via{' '}
                <code>data-density</code> on the document.
              </span>
            </div>
          </div>
        </CardBlock>
      </section>

      {/* Main harness control */}
      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <div>
            <CapsLabel>Main harness control</CapsLabel>
            <div className="off-set-sec-hint">
              Who owns the top-level runtime. Replacement mode stays locked until release evidence
              is recorded.
            </div>
          </div>
        </div>
        <CardBlock>
          <div className="off-set-stat-grid">
            <div className="off-set-stat-card">
              <div className="off-set-stat-k">Default owner</div>
              <div className="off-set-stat-v">{HARNESS_CONTROL.defaultOwner}</div>
            </div>
            <div className="off-set-stat-card">
              <div className="off-set-stat-k">Driver profiles</div>
              <div className="off-set-stat-v">{HARNESS_CONTROL.verifiedProfiles} verified</div>
            </div>
            <div className="off-set-stat-card is-warn">
              <div className="off-set-stat-k">Replacement mode</div>
              <div className="off-set-stat-v">{HARNESS_CONTROL.replacementMode}</div>
            </div>
          </div>
          <div className="mt-[var(--off-sp-4)]">
            {HARNESS_CONTROL.profiles.map((profile) => (
              <div key={profile.name} className="off-set-profile-row">
                <span className="off-set-pr-name">{profile.name}</span>
                <span className={profile.verified ? 'off-set-pr-ok' : 'off-set-pr-no'}>
                  {profile.note}
                </span>
              </div>
            ))}
          </div>
        </CardBlock>
      </section>

      {/* Runtime binding control */}
      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <CapsLabel>Runtime binding</CapsLabel>
        </div>
        <CardBlock>
          <div className="off-set-rbc">
            <SegmentedControl<RuntimeBindingValue>
              wrap
              value={binding}
              onChange={(value) => form.setValue('runtimeBinding', value, { shouldDirty: true })}
              ariaLabel="Runtime binding"
              options={[
                { value: 'inherit', label: 'Inherit' },
                {
                  value: 'gateway',
                  label: 'Provider gateway',
                  icon: <Icon icon={Zap} size="sm" />,
                },
                { value: 'claude', label: 'Claude engine' },
                { value: 'codex', label: 'Codex engine' },
              ]}
            />
            <div className="off-set-rbc-resolved">
              Resolved:{' '}
              <b>{RUNTIME_BINDING_OPTIONS.find((o) => o.value === binding)?.label ?? 'Inherit'}</b>
              <span className="off-set-rbc-source">· source: company override</span>
            </div>
            <div className="off-set-callout is-muted">
              <Icon icon={Info} size="sm" />
              Inherit falls back to user-default. Claude/Codex engines require a verified driver
              profile (Main harness control).
            </div>
          </div>
        </CardBlock>
      </section>

      {/* Conversation memory & summarization */}
      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <CapsLabel>Conversation memory &amp; summarization</CapsLabel>
        </div>
        <CardBlock>
          <div className="off-set-subhead">Memory</div>
          <div className="off-set-grid-4">
            <FieldRow label="Enabled">
              {({ id }) => (
                <Select id={id} options={ENABLED_OPTIONS} {...form.register('memoryEnabled')} />
              )}
            </FieldRow>
            <FieldRow label="Prompt injection">
              {({ id }) => (
                <Select id={id} options={ENABLED_OPTIONS} {...form.register('memoryInjection')} />
              )}
            </FieldRow>
            <FieldRow
              label="Max facts"
              hint={errors.memoryMaxFacts?.message}
              warn={!!errors.memoryMaxFacts}
            >
              {({ id }) => (
                <Input
                  id={id}
                  type="number"
                  {...form.register('memoryMaxFacts', { valueAsNumber: true })}
                />
              )}
            </FieldRow>
            <FieldRow
              label="Confidence"
              hint={errors.memoryConfidence?.message}
              warn={!!errors.memoryConfidence}
            >
              {({ id }) => (
                <Input
                  id={id}
                  type="number"
                  step="0.1"
                  {...form.register('memoryConfidence', { valueAsNumber: true })}
                />
              )}
            </FieldRow>
          </div>
          <div className="off-set-subhead mt-[var(--off-sp-6)]">Summarization</div>
          <div className="off-set-sec-hint mb-[var(--off-sp-3)]">
            Auto-compress long conversations.
          </div>
          <div className="off-set-grid-3">
            <FieldRow label="Enabled">
              {({ id }) => (
                <Select
                  id={id}
                  options={ENABLED_OPTIONS}
                  {...form.register('summarizationEnabled')}
                />
              )}
            </FieldRow>
            <FieldRow
              label="Trigger tokens"
              hint={errors.summarizationTrigger?.message}
              warn={!!errors.summarizationTrigger}
            >
              {({ id }) => (
                <Input
                  id={id}
                  type="number"
                  {...form.register('summarizationTrigger', { valueAsNumber: true })}
                />
              )}
            </FieldRow>
            <FieldRow
              label="Keep recent"
              hint={errors.summarizationKeepRecent?.message}
              warn={!!errors.summarizationKeepRecent}
            >
              {({ id }) => (
                <Input
                  id={id}
                  type="number"
                  {...form.register('summarizationKeepRecent', { valueAsNumber: true })}
                />
              )}
            </FieldRow>
          </div>
        </CardBlock>
      </section>

      {/* Local vault */}
      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <CapsLabel>Local vault</CapsLabel>
        </div>
        <CardBlock className="off-set-vault-card">
          <div className="off-set-vault-head">
            <span className="off-set-vault-ico">
              <Icon icon={FolderOpen} size="sm" />
            </span>
            <div>
              <div className="off-set-vault-title">
                Local vault <span className="off-set-mode-tag">Desktop</span>
              </div>
              <div className="off-set-vault-sub">
                Desktop mirrors employee markdown into Offisim's local vault folder automatically.
              </div>
            </div>
          </div>
          <div className="off-set-vault-status">
            {VAULT_STATUS.employees} employees · {VAULT_STATUS.files} markdown files ·{' '}
            {VAULT_STATUS.size}
            <div className="off-set-vault-path">{VAULT_STATUS.path}</div>
          </div>
          <div className="off-set-vault-actions">
            <Button variant="outline" size="md" onClick={() => toast.info('Opening vault folder')}>
              <Icon icon={FolderOpen} size="sm" />
              Open folder
            </Button>
          </div>
        </CardBlock>
        <CardBlock className="off-set-vault-card">
          <div className="off-set-vault-head">
            <span className="off-set-vault-ico">
              <Icon icon={FolderOpen} size="sm" />
            </span>
            <div>
              <div className="off-set-vault-title">
                Vault directory <span className="off-set-mode-tag">Browser</span>
              </div>
              <div className="off-set-vault-sub">
                Mirror employee markdown into a browser-mounted folder, or export a zip snapshot.
              </div>
            </div>
          </div>
          <div className="off-set-vault-status">
            Live sync is currently off. Mount a local directory to mirror the vault.
          </div>
          <div className="off-set-vault-actions">
            <Button variant="outline" size="md" onClick={() => toast.info('Mounting directory')}>
              <Icon icon={FolderOpen} size="sm" />
              Mount directory
            </Button>
            <Button variant="outline" size="md" onClick={() => toast.info('Unmounted')}>
              <Icon icon={Unlink} size="sm" />
              Unmount
            </Button>
            <Button variant="outline" size="md" onClick={() => toast.success('Vault zip exported')}>
              <Icon icon={Package} size="sm" />
              Export zip
            </Button>
          </div>
        </CardBlock>
      </section>

      {/* 2D scene diagnostics */}
      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <div>
            <CapsLabel>2D scene diagnostics</CapsLabel>
            <div className="off-set-sec-hint">
              Export the last 10 employee→zone drag attempts (PointerEvent stream, hit results, drop
              decision) as JSON for incident debugging.
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => toast.success('Drop diagnostic exported')}
          >
            <Icon icon={Download} size="sm" />
            Export drop diagnostic
          </Button>
        </div>
        <CardBlock>
          <div className="off-set-diag-last">
            <Icon icon={Check} size="sm" />
            Last export: <b>{SCENE_DIAGNOSTIC.lastExport}</b> ·{' '}
            <span className="off-mono">{SCENE_DIAGNOSTIC.lastFileName}</span>
          </div>
        </CardBlock>
      </section>
    </div>
  );
}
