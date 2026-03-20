import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@aics/ui-core';

export interface AvatarConfig {
  skinColor: number;
  hairColor: number;
  hairStyle: string;
  clothingColor: number;
  bodyType: string;
}

interface AvatarCustomizerProps {
  config: AvatarConfig;
  onChange: (config: AvatarConfig) => void;
}

const SKIN_COLORS: { value: number; label: string }[] = [
  { value: 0xfde8d5, label: 'Light' },
  { value: 0xfdbcb4, label: 'Fair' },
  { value: 0xe8a87c, label: 'Medium' },
  { value: 0xb07650, label: 'Tan' },
  { value: 0x6b3f2a, label: 'Dark' },
];

const HAIR_COLORS: { value: number; label: string }[] = [
  { value: 0x1a1a1a, label: 'Black' },
  { value: 0x6b3f1e, label: 'Brown' },
  { value: 0xd4a843, label: 'Blonde' },
  { value: 0xb03020, label: 'Red' },
  { value: 0x9e9e9e, label: 'Gray' },
  { value: 0x3d6bce, label: 'Blue' },
];

const HAIR_STYLES = [
  'short',
  'long',
  'ponytail',
  'curly',
  'bald',
  'bob',
  'spiky',
  'braids',
] as const;

const BODY_TYPES = ['normal', 'slim', 'stocky'] as const;

function hexToCSS(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}

interface SwatchRowProps {
  label: string;
  options: { value: number; label: string }[];
  selected: number;
  onSelect: (value: number) => void;
}

function SwatchRow({ label, options, selected, onSelect }: SwatchRowProps) {
  return (
    <div>
      <p className="text-[10px] text-slate-400 mb-1.5">{label}</p>
      <div className="flex gap-1.5 flex-wrap">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            title={opt.label}
            onClick={() => onSelect(opt.value)}
            className="w-6 h-6 rounded-full border-2 transition-all shrink-0"
            style={{
              backgroundColor: hexToCSS(opt.value),
              borderColor: selected === opt.value ? '#ffffff' : 'transparent',
              boxShadow: selected === opt.value ? '0 0 0 1px rgba(255,255,255,0.3)' : 'none',
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function AvatarCustomizer({ config, onChange }: AvatarCustomizerProps) {
  const set = <K extends keyof AvatarConfig>(key: K, value: AvatarConfig[K]) =>
    onChange({ ...config, [key]: value });

  return (
    <div className="flex flex-col gap-3 p-3 rounded-xl border border-white/10 bg-white/5">
      <p className="text-[10px] font-medium text-slate-300 uppercase tracking-wider">Appearance</p>

      <SwatchRow
        label="Skin tone"
        options={SKIN_COLORS}
        selected={config.skinColor}
        onSelect={(v) => set('skinColor', v)}
      />

      <SwatchRow
        label="Hair color"
        options={HAIR_COLORS}
        selected={config.hairColor}
        onSelect={(v) => set('hairColor', v)}
      />

      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-[10px] text-slate-400 mb-1">Hair style</p>
          <Select value={config.hairStyle} onValueChange={(v) => set('hairStyle', v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HAIR_STYLES.map((s) => (
                <SelectItem key={s} value={s} className="text-xs capitalize">
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <p className="text-[10px] text-slate-400 mb-1">Body type</p>
          <Select value={config.bodyType} onValueChange={(v) => set('bodyType', v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BODY_TYPES.map((b) => (
                <SelectItem key={b} value={b} className="text-xs capitalize">
                  {b.charAt(0).toUpperCase() + b.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
