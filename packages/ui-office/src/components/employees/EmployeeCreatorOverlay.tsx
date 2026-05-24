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
    <div className="employee-creator-shell">
      {/* ── Top Bar ────────────────────────────────────────────────── */}
      <div className="employee-creator-topbar">
        <div className="employee-creator-title-row">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClose}
            className="employee-creator-back-icon"
            aria-label="Back"
          >
            <ArrowLeft data-icon="back" aria-hidden="true" />
          </Button>
          <div />
          <h1>Add employee</h1>
        </div>

        {/* Step Indicator */}
        <div className="employee-creator-stepper">
          {STEPS.map((step, i) => (
            <Button
              key={step}
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setActiveStep(i)}
              className="employee-creator-step-button"
            >
              <div data-active={activeStep === i || undefined}>
                <span>{String(i + 1).padStart(2, '0')}</span>
                <span>{step}</span>
              </div>
              {i < STEPS.length - 1 && <div />}
            </Button>
          ))}
        </div>
      </div>

      {/* ── Main Content ─────────────────────────────────────────── */}
      <div className="employee-creator-body">
        {/* ── Left Panel: Character Preview (45%) ──────────────── */}
        <div className="employee-creator-preview">
          <div className="employee-creator-preview-inner">
            {/* Avatar Preview */}
            <div className="employee-creator-avatar-frame">
              <div>
                <DicebearAvatar
                  seed={effectiveSeed}
                  size={64}
                  className="employee-creator-avatar-mobile"
                />
                <DicebearAvatar
                  seed={effectiveSeed}
                  size={300}
                  className="employee-creator-avatar-desktop"
                />
              </div>
            </div>

            {/* Character Name */}
            <div className="employee-creator-preview-copy">
              <p>{name || <span>Unnamed Employee</span>}</p>
              <div>
                <span>{roleLabel}</span>
              </div>
            </div>
          </div>

          {/* Randomize Button */}
          <Button
            type="button"
            variant="secondary"
            onClick={handleRandomize}
            className="employee-creator-randomize"
          >
            <Dices data-icon="randomize" aria-hidden="true" />
            <span>Randomize</span>
          </Button>
        </div>

        {/* ── Right Panel: Configuration (55%) ─────────────────── */}
        <div className="employee-creator-config">
          <div className="employee-creator-config-inner">
            {/* Section: Identity */}
            <SectionPanel title="IDENTITY" stepIndex={0} activeStep={activeStep}>
              <div className="employee-creator-field-stack">
                <div>
                  <label htmlFor="creator-name">EMPLOYEE NAME</label>
                  <Input
                    id="creator-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter employee name..."
                    className="employee-creator-input"
                    autoFocus
                  />
                </div>
                <div>
                  <label htmlFor="creator-role">ROLE ASSIGNMENT</label>
                  <Select value={role} onValueChange={(value) => setRole(value as RoleSlug)}>
                    <SelectTrigger className="employee-creator-input">
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
              <div className="employee-creator-field-stack">
                <div>
                  <label htmlFor="creator-seed">AVATAR SEED</label>
                  <Input
                    id="creator-seed"
                    value={seed}
                    onChange={(e) => handleSeedChange(e.target.value)}
                    placeholder="Auto-generated from name..."
                    className="employee-creator-input"
                  />
                </div>
                <div>
                  <p className="employee-creator-presets-title">Preset identities</p>
                  <div className="employee-creator-presets">
                    {PRESET_SEEDS.map((presetSeed) => (
                      <Button
                        key={presetSeed}
                        type="button"
                        variant="ghost"
                        onClick={() => handlePresetClick(presetSeed)}
                        className="employee-creator-preset"
                        data-active={seed === presetSeed || undefined}
                      >
                        <DicebearAvatar seed={presetSeed} size={44} />
                        <span>{presetSeed}</span>
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            </SectionPanel>

            <div className="employee-creator-role-defaults">
              <div>Role Defaults</div>
              <p>
                Traits inherit from the selected role in this build. Create the employee first, then
                tune persona and memory from the profile editor.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom Bar ────────────────────────────────────────────── */}
      <div className="employee-creator-actions pb-safe-0">
        <Button
          type="button"
          variant="outline"
          onClick={handleClose}
          className="employee-creator-cancel"
        >
          Cancel
        </Button>
        <Button
          type="button"
          disabled={!canDeploy}
          onClick={handleDeploy}
          className="employee-creator-deploy"
          data-ready={canDeploy || undefined}
        >
          <Rocket data-icon="deploy" aria-hidden="true" />
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
    <div className="employee-creator-section" data-active={isActive || undefined}>
      <div>
        <span>{String(stepIndex + 1).padStart(2, '0')}</span>
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}
