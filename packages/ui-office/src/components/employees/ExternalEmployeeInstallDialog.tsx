import {
  type A2AAgentCard,
  type EmployeeRow,
  type EventBus,
  type RuntimeRepositories,
  employeeCreated,
} from '@offisim/core/browser';
import type { RoleSlug } from '@offisim/shared-types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@offisim/ui-core';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AgentCardDiscoveryError,
  defaultRoleForBrand,
  describeDiscoveryError,
  discoverAgentCard,
  inferBrandKey,
} from '../../lib/agent-card-discovery';
import { type ExternalBrandVariant, REGISTRY } from '../../lib/brand-registry';
import { ROLE_OPTIONS } from '../../lib/roles';

const BRAND_OPTIONS: ReadonlyArray<{ value: ExternalBrandVariant; label: string }> = (
  Object.keys(REGISTRY) as ExternalBrandVariant[]
).map((key) => ({ value: key, label: REGISTRY[key].displayName }));

export interface ExternalEmployeeInstallDialogProps {
  open: boolean;
  onClose: () => void;
  activeCompanyId: string | null;
  repos: RuntimeRepositories | null;
  eventBus: EventBus | null;
  onInstalled?: (row: EmployeeRow) => void;
  onToast?: (message: string, variant?: 'info' | 'success' | 'error') => void;
}

type Step = 'endpoint' | 'preview';

export function ExternalEmployeeInstallDialog({
  open,
  onClose,
  activeCompanyId,
  repos,
  eventBus,
  onInstalled,
  onToast,
}: ExternalEmployeeInstallDialogProps) {
  const [step, setStep] = useState<Step>('endpoint');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [agentId, setAgentId] = useState('');
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [card, setCard] = useState<A2AAgentCard | null>(null);

  const [displayName, setDisplayName] = useState('');
  const [brandKey, setBrandKey] = useState<ExternalBrandVariant>('custom');
  const [roleSlug, setRoleSlug] = useState<RoleSlug | ''>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const resetAll = useCallback(() => {
    setStep('endpoint');
    setUrl('');
    setToken('');
    setAgentId('');
    setIsDiscovering(false);
    setError(null);
    setCard(null);
    setDisplayName('');
    setBrandKey('custom');
    setRoleSlug('');
    setIsSubmitting(false);
    submittingRef.current = false;
  }, []);

  useEffect(() => {
    if (open) return;
    abortRef.current?.abort();
    abortRef.current = null;
    resetAll();
  }, [open, resetAll]);

  const isValidUrl = useMemo(() => {
    const trimmed = url.trim();
    if (!trimmed) return false;
    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }, [url]);

  const handleDiscover = useCallback(async () => {
    if (!isValidUrl || isDiscovering) return;
    setError(null);
    setIsDiscovering(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const discovered = await discoverAgentCard(url.trim(), {
        token: token.trim() || undefined,
        agentId: agentId.trim() || undefined,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const inferredBrand = inferBrandKey(discovered);
      const inferredRole = defaultRoleForBrand(inferredBrand);
      setCard(discovered);
      setDisplayName(discovered.name);
      setBrandKey(inferredBrand);
      setRoleSlug(inferredRole ?? '');
      setStep('preview');
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      if (err instanceof AgentCardDiscoveryError) {
        setError(describeDiscoveryError(err));
      } else {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    } finally {
      setIsDiscovering(false);
      abortRef.current = null;
    }
  }, [agentId, isDiscovering, isValidUrl, token, url]);

  const handleBackToEndpoint = useCallback(() => {
    setCard(null);
    setError(null);
    setStep('endpoint');
  }, []);

  const canConfirm =
    !!card &&
    !!activeCompanyId &&
    !!repos &&
    !!eventBus &&
    displayName.trim().length > 0 &&
    roleSlug.length > 0 &&
    !isSubmitting;

  const handleConfirm = useCallback(async () => {
    if (submittingRef.current) return;
    if (!card || !activeCompanyId || !repos || !eventBus || !roleSlug || !displayName.trim()) {
      return;
    }
    submittingRef.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      const trimmedUrl = url.trim();
      const trimmedToken = token.trim();
      const trimmedAgentId = agentId.trim();
      const { employee_id } = await repos.employees.create({
        company_id: activeCompanyId,
        name: displayName.trim(),
        role_slug: roleSlug,
        source_asset_id: null,
        source_package_id: null,
        is_external: true,
        a2a_url: trimmedUrl,
        a2a_token: trimmedToken.length > 0 ? trimmedToken : null,
        a2a_agent_id: trimmedAgentId.length > 0 ? trimmedAgentId : null,
        brand_key: brandKey,
        agent_card_json: JSON.stringify(card),
      });
      eventBus.emit(
        employeeCreated(activeCompanyId, employee_id, displayName.trim(), roleSlug as RoleSlug),
      );
      const row = await repos.employees.findById(employee_id);
      if (row) onInstalled?.(row);
      onToast?.(`Connected ${displayName.trim()}`, 'success');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create external employee');
    } finally {
      setIsSubmitting(false);
      submittingRef.current = false;
    }
  }, [
    activeCompanyId,
    agentId,
    brandKey,
    card,
    displayName,
    eventBus,
    onClose,
    onInstalled,
    onToast,
    repos,
    roleSlug,
    token,
    url,
  ]);

  const brandEntry = REGISTRY[brandKey];

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {step === 'endpoint' ? 'Connect external A2A agent' : 'Review agent card'}
          </DialogTitle>
          <DialogDescription>
            {step === 'endpoint'
              ? 'Point Offisim at a running A2A endpoint. We will fetch its agent card before anything is persisted.'
              : 'Confirm how this agent should appear in your office before we create the employee.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'endpoint' && (
          <div className="mt-2 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs uppercase tracking-wide text-slate-400" htmlFor="a2a-url">
                Agent base URL
              </label>
              <Input
                id="a2a-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://your-agent.example.dev"
                autoFocus
              />
              <p className="text-[11px] text-slate-500">
                Offisim will GET {'{url}'}/.well-known/agent-card.json with an optional bearer
                token.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs uppercase tracking-wide text-slate-400" htmlFor="a2a-token">
                Bearer token (optional)
              </label>
              <Input
                id="a2a-token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="sk-..."
                type="password"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                className="text-xs uppercase tracking-wide text-slate-400"
                htmlFor="a2a-agent-id"
              >
                Agent ID (optional)
              </label>
              <Input
                id="a2a-agent-id"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                placeholder="primary"
              />
            </div>

            {error && (
              <div
                className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
                role="alert"
              >
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose} disabled={isDiscovering}>
                Cancel
              </Button>
              <Button onClick={handleDiscover} disabled={!isValidUrl || isDiscovering}>
                {isDiscovering ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Discovering…
                  </>
                ) : (
                  'Discover'
                )}
              </Button>
            </div>
          </div>
        )}

        {step === 'preview' && card && (
          <div className="mt-2 flex flex-col gap-4">
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-start gap-3">
                <img
                  alt={`${brandEntry.displayName} avatar`}
                  src={brandEntry.asset2dUri}
                  className="h-12 w-12 rounded-lg"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-100">{card.name}</p>
                  {card.provider?.organization && (
                    <p className="truncate text-xs text-slate-400">{card.provider.organization}</p>
                  )}
                  <p className="mt-1 text-xs text-slate-500">version {card.version}</p>
                </div>
              </div>
              {card.description && (
                <p className="mt-3 text-sm text-slate-300">{card.description}</p>
              )}
              {card.skills && card.skills.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {card.skills.map((skill) => (
                    <li
                      key={skill.id}
                      className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-slate-300"
                    >
                      {skill.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                className="text-xs uppercase tracking-wide text-slate-400"
                htmlFor="a2a-display-name"
              >
                Display name
              </label>
              <Input
                id="a2a-display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="a2a-brand"
                  className="text-xs uppercase tracking-wide text-slate-400"
                >
                  Brand
                </label>
                <Select
                  value={brandKey}
                  onValueChange={(value) => setBrandKey(value as ExternalBrandVariant)}
                >
                  <SelectTrigger id="a2a-brand">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BRAND_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {brandKey === 'custom' && (
                  <p className="text-[11px] text-slate-500">
                    No canonical brand matched — using custom fallback avatar.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="a2a-role"
                  className="text-xs uppercase tracking-wide text-slate-400"
                >
                  Role
                </label>
                <Select value={roleSlug} onValueChange={(value) => setRoleSlug(value as RoleSlug)}>
                  <SelectTrigger id="a2a-role">
                    <SelectValue placeholder="Select role…" />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {error && (
              <div
                className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
                role="alert"
              >
                {error}
              </div>
            )}

            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={handleBackToEndpoint} disabled={isSubmitting}>
                Back
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
                  Cancel
                </Button>
                <Button onClick={handleConfirm} disabled={!canConfirm}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Creating…
                    </>
                  ) : (
                    'Confirm'
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
