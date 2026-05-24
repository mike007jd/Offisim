import type { RoleSlug } from '@offisim/shared-types';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ToastBanner,
  cn,
  useRegisterModal,
  useToasts,
  useTopmostEscape,
} from '@offisim/ui-core';
import { ArrowLeft, Dices, Rocket } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { showDiscardConfirm } from '../../lib/discard-confirm-toast';
import { ROLE_OPTIONS } from '../../lib/roles';
import { DicebearAvatar } from '../shared/DicebearAvatar';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface EmployeeCreatorOverlayProps {
  open: boolean;
  onClose: () => void;
  onDeploy: (employee: { name: string; role: RoleSlug; seed: string }) => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const PRESET_SEEDS = [
  'atlas',
  'nova',
  'cipher',
  'echo',
  'pulse',
  'drift',
  'spark',
  'helix',
  'vortex',
  'nexus',
  'prism',
  'flux',
] as const;

const STEPS = ['IDENTITY', 'VISUAL'] as const;

// ─── Component ──────────────────────────────────────────────────────────────────

export function EmployeeCreatorOverlay({ open, onClose, onDeploy }: EmployeeCreatorOverlayProps) {
  const { toasts, addToast, dismissToast } = useToasts();
  const [name, setName] = useState('');
  const [role, setRole] = useState<RoleSlug>('developer');
  const [seed, setSeed] = useState('');
  const [activeStep, setActiveStep] = useState(0);

  // Auto-generate seed from name (only when user hasn't manually edited the seed)
  const [seedManuallyEdited, setSeedManuallyEdited] = useState(false);
  const isDirty = name.trim().length > 0 || seedManuallyEdited;

  useEffect(() => {
    if (!seedManuallyEdited && name.trim()) {
      setSeed(name.trim().toLowerCase().replace(/\s+/g, '-'));
    }
  }, [name, seedManuallyEdited]);

  // Reset form when page opens
  useEffect(() => {
    if (open) {
      setName('');
      setRole('developer');
      setSeed('');
      setSeedManuallyEdited(false);
      setActiveStep(0);
    }
  }, [open]);

  const creatorStackId = 'employee-creator';
  const handleClose = useCallback(() => {
    if (!isDirty) {
      onClose();
      return;
    }
    showDiscardConfirm(addToast, { onDiscard: onClose });
  }, [addToast, isDirty, onClose]);

  useRegisterModal(open ? creatorStackId : null, 'overlay');
  useTopmostEscape(open ? creatorStackId : null, handleClose, { enabled: open });

  const effectiveSeed = seed || 'default';

  const handleRandomize = useCallback(() => {
    const randomSeed = `agent-${Math.random().toString(36).slice(2, 8)}`;
    setSeed(randomSeed);
    setSeedManuallyEdited(true);
  }, []);

  const handleSeedChange = useCallback((value: string) => {
    setSeed(value);
    setSeedManuallyEdited(true);
  }, []);

  const handlePresetClick = useCallback((presetSeed: string) => {
    setSeed(presetSeed);
    setSeedManuallyEdited(true);
  }, []);

  const handleDeploy = useCallback(() => {
    if (!name.trim()) return;
    onDeploy({ name: name.trim(), role, seed: effectiveSeed });
  }, [name, role, effectiveSeed, onDeploy]);

  const canDeploy = name.trim().length > 0;

  const roleLabel = useMemo(() => {
    return ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role;
  }, [role]);

  if (!open) return null;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-bg text-ink-1">
      {/* ── Top Bar ────────────────────────────────────────────────── */}
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClose}
            className="gap-2 px-3 py-2.5 text-ink-2"
            aria-label="Back"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Button>
          <div className="hidden h-5 w-px bg-line sm:block" />
          <h1 className="truncate text-fs-sm font-semibold text-ink-1">Add employee</h1>
        </div>

        {/* Step Indicator */}
        <div className="flex shrink-0 items-center gap-1">
          {STEPS.map((step, i) => (
            <Button
              key={step}
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setActiveStep(i)}
              className="h-auto gap-2 p-0"
            >
              <div
                className={cn(
                  'flex items-center gap-1.5 rounded-r-sm px-2 py-1 text-fs-meta font-semibold uppercase tracking-wider transition-colors',
                  activeStep === i
                    ? 'border border-accent bg-accent-surface text-accent'
                    : 'text-ink-4 hover:text-ink-2',
                )}
              >
                <span className="tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                <span className="hidden sm:inline">{step}</span>
              </div>
              {i < STEPS.length - 1 && <div className="mx-1 h-px w-3 bg-line" />}
            </Button>
          ))}
        </div>
      </div>

      {/* ── Main Content ─────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        {/* ── Left Panel: Character Preview (45%) ──────────────── */}
        <div className="flex h-32 w-full shrink-0 flex-row items-center justify-between gap-3 bg-bg px-4 lg:h-auto lg:w-5/12 lg:flex-col lg:justify-center lg:px-0">
          <div className="flex min-w-0 flex-1 items-center gap-3 lg:flex-col lg:gap-6">
            {/* Avatar Preview */}
            <div className="relative shrink-0">
              <div className="rounded-r-pill border-2 border-accent bg-surface-1 p-1 shadow-elev-2 lg:p-1.5">
                <DicebearAvatar
                  seed={effectiveSeed}
                  size={64}
                  className="rounded-r-pill lg:hidden"
                />
                <DicebearAvatar
                  seed={effectiveSeed}
                  size={300}
                  className="hidden rounded-r-pill lg:block"
                />
              </div>
            </div>

            {/* Character Name */}
            <div className="min-w-0 flex-1 text-left lg:text-center">
              <p className="min-h-0 truncate text-fs-lg font-bold text-ink-1 lg:min-h-8 lg:text-fs-xl">
                {name || <span className="italic text-ink-4">Unnamed Employee</span>}
              </p>
              <div className="mt-2 inline-flex items-center rounded-r-sm border border-accent bg-accent-surface px-3 py-1">
                <span className="font-mono text-fs-meta uppercase tracking-wide text-accent">
                  {roleLabel}
                </span>
              </div>
            </div>
          </div>

          {/* Randomize Button */}
          <Button
            type="button"
            variant="secondary"
            onClick={handleRandomize}
            className="shrink-0 gap-2 px-3 py-2.5 text-fs-sm text-ink-2 lg:px-5"
          >
            <Dices className="size-4" aria-hidden="true" />
            <span className="hidden font-mono text-fs-meta uppercase tracking-wider sm:inline">
              Randomize
            </span>
          </Button>
        </div>

        {/* ── Right Panel: Configuration (55%) ─────────────────── */}
        <div className="flex w-full flex-col overflow-y-auto border-t border-line lg:w-7/12 lg:border-l lg:border-t-0">
          <div className="flex flex-1 flex-col gap-5 p-5 pb-10 sm:p-6 md:p-8 md:pb-12">
            {/* Section: Identity */}
            <SectionPanel title="IDENTITY" stepIndex={0} activeStep={activeStep}>
              <div className="flex flex-col gap-4">
                <div>
                  <label
                    htmlFor="creator-name"
                    className="mb-2 block font-mono text-fs-meta text-ink-3"
                  >
                    EMPLOYEE NAME
                  </label>
                  <Input
                    id="creator-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter employee name..."
                    className="h-11 rounded-r-md border-line bg-surface-1 text-ink-1 placeholder:text-ink-4"
                    autoFocus
                  />
                </div>
                <div>
                  <label
                    htmlFor="creator-role"
                    className="mb-2 block font-mono text-fs-meta text-ink-3"
                  >
                    ROLE ASSIGNMENT
                  </label>
                  <Select value={role} onValueChange={(value) => setRole(value as RoleSlug)}>
                    <SelectTrigger className="h-11 rounded-r-md border-line bg-surface-1 text-ink-1">
                      <SelectValue />
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
            </SectionPanel>

            {/* Section: Visual Identity */}
            <SectionPanel title="VISUAL IDENTITY" stepIndex={1} activeStep={activeStep}>
              <div className="flex flex-col gap-4">
                <div>
                  <label
                    htmlFor="creator-seed"
                    className="mb-2 block font-mono text-fs-meta text-ink-3"
                  >
                    AVATAR SEED
                  </label>
                  <Input
                    id="creator-seed"
                    value={seed}
                    onChange={(e) => handleSeedChange(e.target.value)}
                    placeholder="Auto-generated from name..."
                    className="h-11 rounded-r-md border-line bg-surface-1 text-ink-1 placeholder:text-ink-4"
                  />
                </div>
                <div>
                  <p className="mb-3 text-fs-meta font-semibold uppercase tracking-wide text-ink-3">
                    Preset identities
                  </p>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                    {PRESET_SEEDS.map((presetSeed) => (
                      <Button
                        key={presetSeed}
                        type="button"
                        variant="ghost"
                        onClick={() => handlePresetClick(presetSeed)}
                        className={cn(
                          'h-auto flex-col gap-1.5 rounded-r-lg border p-3 transition-all',
                          seed === presetSeed
                            ? 'border-accent bg-accent-surface shadow-elev-1'
                            : 'border-line bg-surface-1 hover:border-line-strong hover:bg-surface-sunken',
                        )}
                      >
                        <DicebearAvatar seed={presetSeed} size={44} />
                        <span className="font-mono text-fs-meta text-ink-3">{presetSeed}</span>
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            </SectionPanel>

            <div className="rounded-r-lg border border-line bg-surface-1 p-5">
              <div className="font-mono text-fs-meta uppercase tracking-wide text-ink-3">
                Role Defaults
              </div>
              <p className="mt-2 text-fs-sm leading-relaxed text-ink-2">
                Traits inherit from the selected role in this build. Create the employee first, then
                tune persona and memory from the profile editor.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom Bar ────────────────────────────────────────────── */}
      <div className="pb-safe-0 flex h-16 shrink-0 items-center justify-between gap-3 border-t border-line px-4 sm:px-6 md:px-8">
        <Button
          type="button"
          variant="outline"
          onClick={handleClose}
          className="px-4 py-2.5 text-fs-meta font-medium uppercase tracking-wide text-ink-2 sm:px-5"
        >
          Cancel
        </Button>
        <Button
          type="button"
          disabled={!canDeploy}
          onClick={handleDeploy}
          className={cn(
            'gap-2 rounded-r-lg px-5 py-3 text-fs-sm font-semibold transition-all duration-200 sm:px-8',
            canDeploy
              ? 'bg-accent text-accent-fg shadow-elev-1 hover:bg-accent-press active:scale-95'
              : 'cursor-not-allowed bg-line text-ink-4',
          )}
        >
          <Rocket className="size-4" aria-hidden="true" />
          Add Employee
        </Button>
      </div>
      <ToastBanner toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────────

interface SectionPanelProps {
  title: string;
  stepIndex: number;
  activeStep: number;
  children: React.ReactNode;
}

function SectionPanel({ title, stepIndex, activeStep, children }: SectionPanelProps) {
  const isActive = activeStep === stepIndex;
  return (
    <div
      className={cn(
        'rounded-r-lg border p-6 transition-colors',
        isActive ? 'border-accent bg-accent-surface' : 'border-line bg-surface-1',
      )}
    >
      <div className="mb-4 flex items-center gap-3">
        <span
          className={cn(
            'flex size-6 items-center justify-center rounded-r-xs font-mono text-fs-meta font-bold',
            isActive ? 'bg-accent text-accent-fg' : 'bg-surface-sunken text-ink-4',
          )}
        >
          {String(stepIndex + 1).padStart(2, '0')}
        </span>
        <h2
          className={cn(
            'font-mono text-fs-meta font-semibold tracking-wider',
            isActive ? 'text-accent' : 'text-ink-3',
          )}
        >
          {title}
        </h2>
      </div>
      {children}
    </div>
  );
}
