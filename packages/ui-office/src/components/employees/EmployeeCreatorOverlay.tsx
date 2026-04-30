import type { RoleSlug } from '@offisim/shared-types';
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ToastBanner,
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
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface text-text-primary">
      {/* ── Top Bar ────────────────────────────────────────────────── */}
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border-default px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={handleClose}
            className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="hidden h-5 w-px bg-border-default sm:block" />
          <h1 className="truncate text-sm font-semibold text-text-primary">Add employee</h1>
        </div>

        {/* Step Indicator */}
        <div className="flex shrink-0 items-center gap-1">
          {STEPS.map((step, i) => (
            <button
              key={step}
              type="button"
              onClick={() => setActiveStep(i)}
              className="flex items-center gap-2"
            >
              <div
                className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                  activeStep === i
                    ? 'border border-border-focus bg-accent-muted text-accent-text'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                <span className="tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                <span className="hidden sm:inline">{step}</span>
              </div>
              {i < STEPS.length - 1 && <div className="mx-1 h-px w-3 bg-border-default" />}
            </button>
          ))}
        </div>
      </div>

      {/* ── Main Content ─────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        {/* ── Left Panel: Character Preview (45%) ──────────────── */}
        <div className="flex h-[120px] w-full shrink-0 flex-row items-center justify-between gap-3 bg-surface px-4 lg:h-auto lg:w-[45%] lg:flex-col lg:justify-center lg:px-0">
          <div className="flex min-w-0 flex-1 items-center gap-3 lg:flex-col lg:gap-6">
            {/* Avatar Preview */}
            <div className="relative shrink-0">
              <div className="rounded-full border-2 border-border-focus bg-surface-elevated p-1 shadow-glow-accent lg:p-1.5">
                <DicebearAvatar seed={effectiveSeed} size={64} className="rounded-full lg:hidden" />
                <DicebearAvatar
                  seed={effectiveSeed}
                  size={300}
                  className="hidden rounded-full lg:block"
                />
              </div>
            </div>

            {/* Character Name */}
            <div className="min-w-0 flex-1 text-left lg:text-center">
              <p className="min-h-0 truncate text-lg font-bold text-text-primary lg:min-h-[2rem] lg:text-2xl">
                {name || <span className="italic text-text-disabled">Unnamed Employee</span>}
              </p>
              <div className="mt-2 inline-flex items-center rounded-md border border-border-focus bg-accent-muted px-3 py-1">
                <span className="font-mono text-xs uppercase tracking-wider text-accent-text">
                  {roleLabel}
                </span>
              </div>
            </div>
          </div>

          {/* Randomize Button */}
          <button
            type="button"
            onClick={handleRandomize}
            className="flex shrink-0 items-center gap-2 rounded-xl border border-border-default bg-surface-elevated px-3 py-2.5 text-sm text-text-secondary transition-all hover:border-border-strong hover:bg-surface-hover hover:text-text-primary lg:px-5"
          >
            <Dices className="h-4 w-4" />
            <span className="hidden font-mono text-xs uppercase tracking-wider sm:inline">
              Randomize
            </span>
          </button>
        </div>

        {/* ── Right Panel: Configuration (55%) ─────────────────── */}
        <div className="flex w-full flex-col overflow-y-auto border-t border-border-default lg:w-[55%] lg:border-l lg:border-t-0">
          <div className="flex flex-1 flex-col gap-5 p-5 pb-10 sm:p-6 md:p-8 md:pb-12">
            {/* Section: Identity */}
            <SectionPanel title="IDENTITY" stepIndex={0} activeStep={activeStep}>
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="creator-name"
                    className="mb-2 block font-mono text-xs text-text-muted"
                  >
                    EMPLOYEE NAME
                  </label>
                  <Input
                    id="creator-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter employee name..."
                    className="h-11 rounded-lg border-border-default bg-surface text-text-primary placeholder:text-text-muted"
                    autoFocus
                  />
                </div>
                <div>
                  <label
                    htmlFor="creator-role"
                    className="mb-2 block font-mono text-xs text-text-muted"
                  >
                    ROLE ASSIGNMENT
                  </label>
                  <Select value={role} onValueChange={(value) => setRole(value as RoleSlug)}>
                    <SelectTrigger className="h-11 rounded-lg border-border-default bg-surface text-text-primary">
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
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="creator-seed"
                    className="mb-2 block font-mono text-xs text-text-muted"
                  >
                    AVATAR SEED
                  </label>
                  <Input
                    id="creator-seed"
                    value={seed}
                    onChange={(e) => handleSeedChange(e.target.value)}
                    placeholder="Auto-generated from name..."
                    className="h-11 rounded-lg border-border-default bg-surface text-text-primary placeholder:text-text-muted"
                  />
                </div>
                <div>
                  <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                    Preset identities
                  </p>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                    {PRESET_SEEDS.map((presetSeed) => (
                      <button
                        key={presetSeed}
                        type="button"
                        onClick={() => handlePresetClick(presetSeed)}
                        className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 transition-all ${
                          seed === presetSeed
                            ? 'border-border-focus bg-accent-muted shadow-glow-accent'
                            : 'border-border-default bg-surface-muted hover:border-border-strong hover:bg-surface-hover'
                        }`}
                      >
                        <DicebearAvatar seed={presetSeed} size={44} />
                        <span className="font-mono text-[10px] text-text-muted">{presetSeed}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </SectionPanel>

            <div className="rounded-xl border border-border-default bg-surface-muted p-5">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                Role Defaults
              </div>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                Traits inherit from the selected role in this build. Create the employee first, then
                tune persona and memory from the profile editor.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom Bar ────────────────────────────────────────────── */}
      <div
        className="flex h-16 shrink-0 items-center justify-between gap-3 border-t border-border-default px-4 sm:px-6 md:px-8"
        style={{ paddingBottom: 'max(0px, env(safe-area-inset-bottom))' }}
      >
        <button
          type="button"
          onClick={handleClose}
          className="rounded-lg border border-border-default px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary sm:px-5"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!canDeploy}
          onClick={handleDeploy}
          className={`flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition-all duration-200 sm:px-8 ${
            canDeploy
              ? 'bg-accent text-text-inverse shadow-glow-accent hover:bg-accent-hover hover:shadow-glow-accent active:scale-[0.98]'
              : 'cursor-not-allowed bg-surface-disabled text-text-disabled'
          }`}
        >
          <Rocket className="h-4 w-4" />
          Add Employee
        </button>
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
      className={`rounded-2xl border p-6 transition-colors ${
        isActive ? 'border-border-focus bg-accent-muted' : 'border-border-default bg-surface-muted'
      }`}
    >
      <div className="mb-4 flex items-center gap-3">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded font-mono text-[10px] font-bold ${
            isActive ? 'bg-accent-muted text-accent-text' : 'bg-surface-hover text-text-disabled'
          }`}
        >
          {String(stepIndex + 1).padStart(2, '0')}
        </span>
        <h2
          className={`font-mono text-xs font-semibold tracking-[0.15em] ${
            isActive ? 'text-accent-text' : 'text-text-muted'
          }`}
        >
          {title}
        </h2>
      </div>
      {children}
    </div>
  );
}
