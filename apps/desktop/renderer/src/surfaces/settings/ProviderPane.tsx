import {
  CapsLabel,
  CardBlock,
  FieldRow,
  Select,
  StatusPill,
} from '@/design-system/grammar/index.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { Input } from '@/design-system/primitives/input.js';
import { Textarea } from '@/design-system/primitives/textarea.js';
import { AlertTriangle, ChevronRight, Eye, EyeOff, Info, Key, Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import {
  ACCESS_MODE_OPTIONS,
  CATALOG_STATE,
  EXECUTION_LANE_OPTIONS,
  MODEL_SUGGESTIONS,
  PRODUCT_OPTIONS,
  PROVIDER_HEALTH_LABELS,
  PROVIDER_VARIANT_OPTIONS,
  type ProviderConfig,
  type ProviderFormValues,
  useProviderConfigs,
} from './settings-data.js';

interface ProviderPaneProps {
  form: UseFormReturn<ProviderFormValues>;
  activeConfigId: string;
  onSelectConfig: (config: ProviderConfig) => void;
}

function healthTone(health: ProviderConfig['health']) {
  if (health === 'active' || health === 'reachable') return 'ok' as const;
  return 'muted' as const;
}

export function ProviderPane({ form, activeConfigId, onSelectConfig }: ProviderPaneProps) {
  const { data: configs } = useProviderConfigs();
  const [revealKey, setRevealKey] = useState(false);
  const accessMode = form.watch('accessMode');
  const isManaged = accessMode === 'managed';
  const isHostResolved = accessMode === 'host-resolved' || accessMode === 'managed';

  const active = configs.find((c) => c.id === activeConfigId) ?? configs[0];
  if (!active) return null;

  const effectiveEndpoint = `${active.credentialDestination}/v1/text/chatcompletion_v2`;

  return (
    <div className="off-set-pane">
      <div className="off-set-panehead">
        <div className="off-set-panetitle">Provider</div>
        <div className="off-set-panedesc">
          The model vendor every employee uses. Offisim calls the vendor API directly — there is no
          proxy. Product + access mode resolve the route; the execution lane decides whether Offisim
          tools are exposed.
        </div>
      </div>

      {/* Connected provider card */}
      <section className="off-set-sec">
        <CardBlock>
          <div className="off-set-pv-row">
            <div
              className="off-set-pv-logo"
              style={{
                background: `linear-gradient(135deg, ${active.logoGradient[0]}, ${active.logoGradient[1]})`,
              }}
            >
              {active.logoMark}
            </div>
            <div className="min-w-0">
              <div className="off-set-pv-name">
                {active.displayName}
                <StatusPill tone={active.hasStoredKey ? 'ok' : 'muted'}>
                  {active.hasStoredKey ? 'Connected' : 'No key'}
                </StatusPill>
              </div>
              <div className="off-set-pv-meta">
                {active.model} · {active.lane} lane · {active.region} · {active.endpointKind}
              </div>
            </div>
            <Button
              variant="outline"
              size="md"
              onClick={() => toast.success(`Tested ${active.displayName}`)}
            >
              <Icon icon={RefreshCw} size="sm" />
              Test connection
            </Button>
          </div>
        </CardBlock>
      </section>

      {/* Multi-config picker */}
      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <CapsLabel>Configurations</CapsLabel>
        </div>
        <CardBlock>
          <div className="off-set-pv-grid">
            {configs.map((config) => (
              <button
                key={config.id}
                type="button"
                className={`off-set-pv-mini off-focusable${config.id === activeConfigId ? ' is-active' : ''}`}
                onClick={() => onSelectConfig(config)}
              >
                <span
                  className="off-set-pm-logo"
                  style={{
                    background: `linear-gradient(135deg, ${config.logoGradient[0]}, ${config.logoGradient[1]})`,
                  }}
                >
                  {config.logoMark}
                </span>
                <span className="min-w-0 text-left">
                  <span className="off-set-pm-name">{config.displayName}</span>
                  <span className="off-set-pm-sub">{config.subtitle}</span>
                </span>
                <StatusPill tone={healthTone(config.health)}>
                  {PROVIDER_HEALTH_LABELS[config.health]}
                </StatusPill>
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="md"
            className="mt-[var(--off-sp-4)]"
            onClick={() => toast.info('Add provider config')}
          >
            <Icon icon={Plus} size="sm" />
            Add provider config
          </Button>
        </CardBlock>
      </section>

      {/* Route */}
      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <CapsLabel>Route</CapsLabel>
        </div>
        <CardBlock>
          <div className="off-set-grid-2">
            <FieldRow label="Product">
              {({ id }) => (
                <Select id={id} options={PRODUCT_OPTIONS} {...form.register('product')} />
              )}
            </FieldRow>
            <FieldRow label="Access mode">
              {({ id }) => (
                <Select id={id} options={ACCESS_MODE_OPTIONS} {...form.register('accessMode')} />
              )}
            </FieldRow>
            <div className="off-set-span-2 off-field">
              <div className="off-set-route-summary">
                <span className="off-set-rs-name">{active.displayName}</span>
                <span className="off-set-chip-mini">
                  {ACCESS_MODE_OPTIONS.find((o) => o.value === accessMode)?.label ??
                    'Global API key'}
                </span>
                <span className="off-set-route-trail">
                  openai-compat · {active.endpointKind} · {active.region}
                </span>
              </div>
              <span className="off-field-hint">
                Direct key auth against the {active.displayName} endpoint. No host resolver
                required.
              </span>
            </div>
          </div>
        </CardBlock>
      </section>

      {/* Model */}
      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <CapsLabel>Model</CapsLabel>
        </div>
        <CardBlock>
          <FieldRow
            label="Model"
            hint={
              form.formState.errors.model?.message ??
              'Free-form id with suggestions from the scoped catalog (see Advanced model catalog).'
            }
            warn={!!form.formState.errors.model}
          >
            {({ id }) => (
              <>
                <Input
                  id={id}
                  className="off-mono"
                  list="off-set-modelopts"
                  placeholder="model-name"
                  {...form.register('model')}
                />
                <datalist id="off-set-modelopts">
                  {MODEL_SUGGESTIONS.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </>
            )}
          </FieldRow>
        </CardBlock>
      </section>

      {/* Credentials */}
      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <CapsLabel>Credentials</CapsLabel>
        </div>
        <CardBlock>
          {isManaged ? (
            <div className="off-set-callout is-muted">
              <Icon icon={Info} size="sm" />
              Credentials managed by host.
            </div>
          ) : (
            <div className="off-field">
              <span className="off-field-label">Secure API key</span>
              <div className="off-set-ctl is-mono">
                <span className="off-set-ctl-lead">
                  <Icon icon={Key} size="sm" />
                </span>
                <Input
                  type={revealKey ? 'text' : 'password'}
                  className="off-set-ctl-input"
                  placeholder="sk-…"
                  {...form.register('apiKey')}
                />
                <button
                  type="button"
                  className="off-set-ctl-trail off-focusable"
                  aria-label={revealKey ? 'Hide key' : 'Reveal key'}
                  onClick={() => setRevealKey((v) => !v)}
                >
                  <Icon icon={revealKey ? EyeOff : Eye} size="sm" />
                </button>
              </div>
              <span className="off-field-hint">
                Leave empty to keep the stored credential · Credential destination:{' '}
                <b>{active.credentialDestination}</b>
              </span>
            </div>
          )}
          <div className="mt-[var(--off-sp-4)] flex flex-col gap-[var(--off-sp-2)]">
            {active.isThinking ? (
              <div className="off-set-callout is-warn">
                <Icon icon={AlertTriangle} size="sm" />
                Thinking model — keep max tokens at 1024+.
              </div>
            ) : null}
            {isHostResolved ? (
              <div className="off-set-callout is-info">
                <Icon icon={Info} size="sm" />
                Runtime binding activates only when a trusted host resolver is available.
              </div>
            ) : null}
          </div>
        </CardBlock>
      </section>

      {/* Advanced */}
      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <CapsLabel>Advanced</CapsLabel>
        </div>

        <details className="off-set-disclosure">
          <summary>
            <span className="off-set-chev">
              <Icon icon={ChevronRight} size="sm" />
            </span>
            Advanced model catalog
          </summary>
          <div className="off-set-disclosure-body">
            <div className="off-set-catalog-row">
              <div>
                <div className="off-set-cr-t">Model catalog refresh</div>
                <div className="off-set-cr-meta">
                  Last success {CATALOG_STATE.lastSuccess} · {CATALOG_STATE.scopeSummary}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => toast.success('Catalog refresh started')}
              >
                <Icon icon={RefreshCw} size="sm" />
                Refresh catalog
              </Button>
            </div>
            <div className="mb-[var(--off-sp-3)] flex items-center gap-[var(--off-sp-3)]">
              <span className="off-set-chip-mini">Agent scoped</span>
              <span className="text-[length:var(--off-fs-meta)] text-[color:var(--off-ink-3)]">
                {CATALOG_STATE.freshCount} fresh model suggestions for {active.displayName}.
              </span>
            </div>
            <div className="off-set-catalog-srcs">
              {CATALOG_STATE.sources.map((src) => (
                <div key={src.label} className="off-set-catalog-src">
                  <div className="off-set-cs-label">{src.label}</div>
                  <div className="off-set-cs-sum">{src.summary}</div>
                </div>
              ))}
            </div>
            {CATALOG_STATE.error ? (
              <div className="off-set-catalog-err">
                <Icon icon={AlertTriangle} size="sm" />
                {CATALOG_STATE.error}
              </div>
            ) : null}
          </div>
        </details>

        <details className="off-set-disclosure" open>
          <summary>
            <span className="off-set-chev">
              <Icon icon={ChevronRight} size="sm" />
            </span>
            Advanced routing
          </summary>
          <div className="off-set-disclosure-body">
            <p className="off-set-sec-hint mb-[var(--off-sp-4)] mt-0">
              {active.displayName} key route. Variant and execution lane resolve the transport.
            </p>
            <div className="off-set-grid-2">
              <FieldRow label="Provider variant">
                {({ id }) => (
                  <Select
                    id={id}
                    options={PROVIDER_VARIANT_OPTIONS}
                    {...form.register('variant')}
                  />
                )}
              </FieldRow>
              <FieldRow
                label="Execution lane"
                hint="Gateway lane exposes Offisim tools when the runtime has a trusted host + workspace. SDK options are model-transport bindings only — not a tools-capable product lane."
              >
                {({ id }) => (
                  <Select id={id} options={EXECUTION_LANE_OPTIONS} {...form.register('lane')} />
                )}
              </FieldRow>
              <FieldRow
                className="off-set-span-2"
                label={
                  <>
                    Endpoint override <span className="off-set-opt">· optional</span>
                  </>
                }
                hint="Leave empty to use the product default."
              >
                {({ id }) => (
                  <Input
                    id={id}
                    className="off-mono"
                    placeholder={`${active.credentialDestination}/v1`}
                    {...form.register('endpointOverride')}
                  />
                )}
              </FieldRow>
              <FieldRow
                className="off-set-span-2"
                label={
                  <>
                    Default headers <span className="off-set-opt">· JSON</span>
                  </>
                }
                hint="JSON merged into transport headers."
              >
                {({ id }) => (
                  <Textarea
                    id={id}
                    className="off-mono"
                    placeholder='{"HTTP-Referer":"https://example.com"}'
                    {...form.register('headersJson')}
                  />
                )}
              </FieldRow>
              <FieldRow
                className="off-set-span-2"
                label="Effective endpoint"
                hint={`${active.displayName} chat completion endpoint.`}
              >
                {({ id }) => (
                  <Input
                    id={id}
                    className="off-mono"
                    value={effectiveEndpoint}
                    readOnly
                    tabIndex={-1}
                  />
                )}
              </FieldRow>
            </div>
          </div>
        </details>
      </section>
    </div>
  );
}
