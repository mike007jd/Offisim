import { Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@aics/ui-core';
import { ArrowLeft, Box, Dices, Monitor, Rocket } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DicebearAvatar } from '../shared/DicebearAvatar';
import { ROLE_OPTIONS } from '../../lib/roles';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface EmployeeCreatorOverlayProps {
  open: boolean;
  onClose: () => void;
  onDeploy: (employee: { name: string; role: string; seed: string }) => void;
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

const STEPS = ['IDENTITY', 'VISUAL', 'ATTRIBUTES'] as const;

type PreviewMode = '2d' | '3d';

// ─── Component ──────────────────────────────────────────────────────────────────

export function EmployeeCreatorOverlay({ open, onClose, onDeploy }: EmployeeCreatorOverlayProps) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<string>('developer');
  const [seed, setSeed] = useState('');
  const [previewMode, setPreviewMode] = useState<PreviewMode>('2d');
  const [creativity, setCreativity] = useState(5);
  const [speed, setSpeed] = useState(5);
  const [quality, setQuality] = useState(5);
  const [activeStep, setActiveStep] = useState(0);

  // Auto-generate seed from name (only when user hasn't manually edited the seed)
  const [seedManuallyEdited, setSeedManuallyEdited] = useState(false);

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
      setPreviewMode('2d');
      setCreativity(5);
      setSpeed(5);
      setQuality(5);
      setSeedManuallyEdited(false);
      setActiveStep(0);
    }
  }, [open]);

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
    <div className="h-screen w-screen bg-[#02040a] flex flex-col overflow-hidden">
      {/* ── Top Bar ────────────────────────────────────────────────── */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.06] px-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-white/50 transition-colors hover:bg-white/[0.05] hover:text-white/80"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="h-5 w-px bg-white/10" />
          <h1 className="font-mono text-sm font-bold uppercase tracking-[0.2em] text-white/90">
            AGENT_DEPLOYMENT_INTERFACE
          </h1>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center gap-1">
          {STEPS.map((step, i) => (
            <button
              key={step}
              type="button"
              onClick={() => setActiveStep(i)}
              className="flex items-center gap-2"
            >
              <div
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 font-mono text-[10px] tracking-[0.15em] transition-colors ${
                  activeStep === i
                    ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                    : 'text-white/30 hover:text-white/50'
                }`}
              >
                <span className="tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                <span>{step}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className="mx-1 h-px w-4 bg-white/10" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Main Content ─────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Left Panel: Character Preview (45%) ──────────────── */}
        <div className="flex w-[45%] shrink-0 flex-col items-center justify-center bg-[#020409]">
          <div className="flex flex-col items-center gap-6">
            {/* Avatar Preview */}
            <div className="relative">
              {previewMode === '2d' ? (
                <div className="rounded-full border-2 border-blue-500/30 shadow-[0_0_60px_rgba(59,130,246,0.12)] p-1.5">
                  <DicebearAvatar seed={effectiveSeed} size={300} className="rounded-full" />
                </div>
              ) : (
                <div className="flex h-[300px] w-[300px] items-center justify-center rounded-full border-2 border-white/10 bg-white/[0.02]">
                  <div className="text-center">
                    <Box className="mx-auto mb-3 h-12 w-12 text-white/20" />
                    <span className="font-mono text-xs uppercase tracking-wider text-white/30">
                      Coming Soon
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Character Name */}
            <div className="text-center">
              <p className="min-h-[2rem] text-2xl font-bold text-white/90">
                {name || <span className="italic text-white/20">Unnamed Agent</span>}
              </p>
              <div className="mt-2 inline-flex items-center rounded-md border border-blue-500/20 bg-blue-500/10 px-3 py-1">
                <span className="font-mono text-xs uppercase tracking-wider text-blue-400/80">
                  {roleLabel}
                </span>
              </div>
            </div>

            {/* 2D / 3D Toggle */}
            <div className="flex overflow-hidden rounded-lg border border-white/10 bg-white/[0.03]">
              <button
                type="button"
                onClick={() => setPreviewMode('2d')}
                className={`flex items-center gap-1.5 px-4 py-2 font-mono text-xs tracking-wider transition-colors ${
                  previewMode === '2d'
                    ? 'bg-blue-500/20 text-blue-400 border-r border-blue-500/30'
                    : 'text-white/40 hover:text-white/60 border-r border-white/10'
                }`}
              >
                <Monitor className="h-3.5 w-3.5" />
                2D
              </button>
              <button
                type="button"
                onClick={() => setPreviewMode('3d')}
                className={`flex items-center gap-1.5 px-4 py-2 font-mono text-xs tracking-wider transition-colors ${
                  previewMode === '3d'
                    ? 'bg-blue-500/20 text-blue-400'
                    : 'text-white/40 hover:text-white/60'
                }`}
              >
                <Box className="h-3.5 w-3.5" />
                3D
              </button>
            </div>

            {/* Randomize Button */}
            <button
              type="button"
              onClick={handleRandomize}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-5 py-2.5 text-sm text-white/60 transition-all hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
            >
              <Dices className="h-4 w-4" />
              <span className="font-mono text-xs uppercase tracking-wider">Randomize</span>
            </button>
          </div>
        </div>

        {/* ── Right Panel: Configuration (55%) ─────────────────── */}
        <div className="flex w-[55%] flex-col border-l border-white/[0.06] overflow-y-auto">
          <div className="flex flex-1 flex-col gap-5 p-8">
            {/* Section: Identity */}
            <SectionPanel title="IDENTITY" stepIndex={0} activeStep={activeStep}>
              <div className="space-y-4">
                <div>
                  <label htmlFor="creator-name" className="mb-2 block font-mono text-xs text-white/50">
                    AGENT NAME
                  </label>
                  <Input
                    id="creator-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter agent designation..."
                    className="bg-white/[0.04] border-white/10 rounded-lg text-white placeholder:text-white/20 h-11"
                    autoFocus
                  />
                </div>
                <div>
                  <label htmlFor="creator-role" className="mb-2 block font-mono text-xs text-white/50">
                    ROLE ASSIGNMENT
                  </label>
                  <Select value={role} onValueChange={setRole}>
                    <SelectTrigger className="bg-white/[0.04] border-white/10 rounded-lg text-white h-11">
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
                  <label htmlFor="creator-seed" className="mb-2 block font-mono text-xs text-white/50">
                    AVATAR SEED
                  </label>
                  <Input
                    id="creator-seed"
                    value={seed}
                    onChange={(e) => handleSeedChange(e.target.value)}
                    placeholder="Auto-generated from name..."
                    className="bg-white/[0.04] border-white/10 rounded-lg text-white placeholder:text-white/20 h-11"
                  />
                </div>
                <div>
                  <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.15em] text-white/30">
                    PRESET IDENTITIES
                  </p>
                  <div className="grid grid-cols-6 gap-2">
                    {PRESET_SEEDS.map((presetSeed) => (
                      <button
                        key={presetSeed}
                        type="button"
                        onClick={() => handlePresetClick(presetSeed)}
                        className={`flex flex-col items-center gap-1.5 rounded-xl border p-2.5 transition-all ${
                          seed === presetSeed
                            ? 'border-blue-500/40 bg-blue-500/10 shadow-[0_0_12px_rgba(59,130,246,0.15)]'
                            : 'border-white/[0.06] bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.05]'
                        }`}
                      >
                        <DicebearAvatar seed={presetSeed} size={44} />
                        <span className="font-mono text-[9px] text-white/40">{presetSeed}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </SectionPanel>

            {/* Section: Attributes (preview) */}
            <SectionPanel title="TRAIT MATRIX" stepIndex={2} activeStep={activeStep}>
              <p className="mb-4 font-mono text-[10px] italic text-white/25">
                Display only -- trait tuning coming in a future update
              </p>
              <div className="space-y-1">
                <TraitSlider label="Creativity" value={creativity} onChange={setCreativity} />
                <TraitSlider label="Speed" value={speed} onChange={setSpeed} />
                <TraitSlider label="Quality" value={quality} onChange={setQuality} />
              </div>
            </SectionPanel>
          </div>
        </div>
      </div>

      {/* ── Bottom Bar ────────────────────────────────────────────── */}
      <div className="flex h-16 shrink-0 items-center justify-between border-t border-white/[0.06] px-8">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-white/10 px-5 py-2.5 font-mono text-xs uppercase tracking-wider text-white/50 transition-colors hover:bg-white/[0.05] hover:text-white/70"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!canDeploy}
          onClick={handleDeploy}
          className={`
            flex items-center gap-2.5 rounded-xl px-8 py-3 font-mono text-sm font-semibold uppercase tracking-wider
            transition-all duration-200
            ${canDeploy
              ? 'bg-blue-600 text-white shadow-[0_0_30px_rgba(59,130,246,0.3)] hover:shadow-[0_0_40px_rgba(59,130,246,0.5)] hover:bg-blue-500 active:scale-[0.98]'
              : 'bg-white/[0.04] text-white/20 cursor-not-allowed'
            }
          `}
        >
          <Rocket className="h-4 w-4" />
          Deploy Agent
        </button>
      </div>
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
        isActive
          ? 'border-blue-500/20 bg-blue-500/[0.03]'
          : 'border-white/[0.06] bg-white/[0.02]'
      }`}
    >
      <div className="mb-4 flex items-center gap-3">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded font-mono text-[10px] font-bold ${
            isActive
              ? 'bg-blue-500/20 text-blue-400'
              : 'bg-white/[0.06] text-white/30'
          }`}
        >
          {String(stepIndex + 1).padStart(2, '0')}
        </span>
        <h2
          className={`font-mono text-xs font-semibold tracking-[0.15em] ${
            isActive ? 'text-blue-400/90' : 'text-white/40'
          }`}
        >
          {title}
        </h2>
      </div>
      {children}
    </div>
  );
}

interface TraitSliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
}

function TraitSlider({ label, value, onChange }: TraitSliderProps) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-xs text-white/50">{label}</span>
        <span className="font-mono text-xs tabular-nums text-blue-400/80">{value}/10</span>
      </div>
      <input
        type="range"
        min={1}
        max={10}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full
          bg-white/10
          [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:w-3.5
          [&::-webkit-slider-thumb]:h-3.5
          [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-blue-500
          [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(59,130,246,0.5)]
          [&::-webkit-slider-thumb]:border-0
          [&::-moz-range-thumb]:w-3.5
          [&::-moz-range-thumb]:h-3.5
          [&::-moz-range-thumb]:rounded-full
          [&::-moz-range-thumb]:bg-blue-500
          [&::-moz-range-thumb]:shadow-[0_0_8px_rgba(59,130,246,0.5)]
          [&::-moz-range-thumb]:border-0
        "
      />
    </div>
  );
}
