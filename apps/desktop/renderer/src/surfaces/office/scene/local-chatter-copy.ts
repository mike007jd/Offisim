/**
 * Local office chatter copy catalog (presentation-only).
 *
 * This is a deliberate local slice: the renderer has no global i18n framework
 * yet, so locale normalization and keyed strings live next to the selector.
 * Copy must stay playful and office-safe — never claim real work progress,
 * tool execution, model state, commits, builds, tests, uploads, or delivery.
 */

export type ChatterLocale = 'en' | 'zh-CN';

/** Soft character budget for English bubble lines (graphemes / code units). */
export const CHATTER_COPY_MAX_CHARS_EN = 42;

/** Soft character budget for Simplified Chinese bubble lines. */
export const CHATTER_COPY_MAX_CHARS_ZH = 18;

type SoloPlayfulCopyKey =
  | 'solo.playful.plant'
  | 'solo.playful.sticky'
  | 'solo.playful.mug'
  | 'solo.playful.window'
  | 'solo.playful.lamp';

type SoloComplaintCopyKey =
  | 'solo.complaint.chair'
  | 'solo.complaint.cable'
  | 'solo.complaint.fridge'
  | 'solo.complaint.drawer'
  | 'solo.complaint.clock';

type PairUtteranceCopyKey =
  | 'pair.coffee.a'
  | 'pair.coffee.b'
  | 'pair.window.a'
  | 'pair.window.b'
  | 'pair.snack.a'
  | 'pair.snack.b'
  | 'pair.stretch.a'
  | 'pair.stretch.b';

export type ChatterCopyKey = SoloPlayfulCopyKey | SoloComplaintCopyKey | PairUtteranceCopyKey;

export interface PairDialogueScript {
  readonly id: string;
  readonly keys: readonly [PairUtteranceCopyKey, PairUtteranceCopyKey];
}

export const SOLO_PLAYFUL_COPY_KEYS = [
  'solo.playful.plant',
  'solo.playful.sticky',
  'solo.playful.mug',
  'solo.playful.window',
  'solo.playful.lamp',
] as const satisfies readonly SoloPlayfulCopyKey[];

export const SOLO_COMPLAINT_COPY_KEYS = [
  'solo.complaint.chair',
  'solo.complaint.cable',
  'solo.complaint.fridge',
  'solo.complaint.drawer',
  'solo.complaint.clock',
] as const satisfies readonly SoloComplaintCopyKey[];

/** Preset two-turn dialogues. Order is stable for deterministic rotation. */
export const PAIR_DIALOGUE_SCRIPTS = [
  { id: 'pair.coffee', keys: ['pair.coffee.a', 'pair.coffee.b'] },
  { id: 'pair.window', keys: ['pair.window.a', 'pair.window.b'] },
  { id: 'pair.snack', keys: ['pair.snack.a', 'pair.snack.b'] },
  { id: 'pair.stretch', keys: ['pair.stretch.a', 'pair.stretch.b'] },
] as const satisfies readonly PairDialogueScript[];

const EN_COPY = {
  'solo.playful.plant': 'The desk plant blinked first.',
  'solo.playful.sticky': 'Sticky notes are plotting again.',
  'solo.playful.mug': 'This mug knows too much.',
  'solo.playful.window': 'Clouds are doing their best.',
  'solo.playful.lamp': 'Lamp mood: gently dramatic.',
  'solo.complaint.chair': 'This chair has opinions.',
  'solo.complaint.cable': 'Cable spaghetti strikes again.',
  'solo.complaint.fridge': 'Office fridge mystery continues.',
  'solo.complaint.drawer': 'Drawer squeak, act three.',
  'solo.complaint.clock': 'That wall clock is theatrical.',
  'pair.coffee.a': 'Coffee run?',
  'pair.coffee.b': 'Spiritually, yes.',
  'pair.window.a': 'Nice light by the window.',
  'pair.window.b': 'Saving it for later.',
  'pair.snack.a': 'Snack shelf is calling.',
  'pair.snack.b': 'I hear it too.',
  'pair.stretch.a': 'Stretch break?',
  'pair.stretch.b': 'My shoulders vote yes.',
} as const satisfies Record<ChatterCopyKey, string>;

const ZH_CN_COPY = {
  'solo.playful.plant': '桌上的绿植先眨了眼。',
  'solo.playful.sticky': '便利贴又在密谋了。',
  'solo.playful.mug': '这只杯子知道太多。',
  'solo.playful.window': '窗外云彩在认真营业。',
  'solo.playful.lamp': '台灯情绪：有点戏精。',
  'solo.complaint.chair': '这把椅子很有想法。',
  'solo.complaint.cable': '桌下线缆又打结了。',
  'solo.complaint.fridge': '冰箱悬案仍在续写。',
  'solo.complaint.drawer': '抽屉吱呀，第三幕。',
  'solo.complaint.clock': '墙上的钟很会演戏。',
  'pair.coffee.a': '去续杯？',
  'pair.coffee.b': '精神上已经出发了。',
  'pair.window.a': '窗边光线不错。',
  'pair.window.b': '先存着，晚点用。',
  'pair.snack.a': '零食架在召唤。',
  'pair.snack.b': '我也听见了。',
  'pair.stretch.a': '起来伸个懒腰？',
  'pair.stretch.b': '肩膀举双手赞成。',
} as const satisfies Record<ChatterCopyKey, string>;

const COPY_BY_LOCALE: Record<ChatterLocale, Readonly<Record<ChatterCopyKey, string>>> = {
  en: EN_COPY,
  'zh-CN': ZH_CN_COPY,
};

/**
 * Normalize BCP-47-ish tags for this local chatter slice.
 * Chinese locale tags, including Traditional variants, map to `zh-CN`;
 * everything else → `en`.
 */
export function normalizeChatterLocale(tag: string | null | undefined): ChatterLocale {
  if (typeof tag !== 'string') return 'en';
  const trimmed = tag.trim();
  if (!trimmed) return 'en';
  const compact = trimmed.replace(/_/g, '-');
  const lower = compact.toLowerCase();
  if (lower === 'en' || lower.startsWith('en-')) return 'en';
  if (lower === 'zh' || lower.startsWith('zh-')) return 'zh-CN';
  return 'en';
}

export function resolveChatterCopy(locale: ChatterLocale, key: ChatterCopyKey): string {
  return COPY_BY_LOCALE[locale][key];
}

export function chatterCopyCatalog(
  locale: ChatterLocale,
): Readonly<Record<ChatterCopyKey, string>> {
  return COPY_BY_LOCALE[locale];
}

export function allChatterCopyKeys(): readonly ChatterCopyKey[] {
  return Object.keys(EN_COPY) as ChatterCopyKey[];
}
