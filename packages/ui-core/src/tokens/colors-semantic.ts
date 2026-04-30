export interface SemanticColors {
  surface: string;
  surfaceElevated: string;
  surfaceMuted: string;
  surfaceHover: string;
  surfaceActive: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textDisabled: string;
  textInverse: string;
  borderSubtle: string;
  borderDefault: string;
  borderStrong: string;
  borderFocus: string;
  accent: string;
  accentHover: string;
  accentMuted: string;
  accentText: string;
  success: string;
  successMuted: string;
  warning: string;
  warningMuted: string;
  error: string;
  errorMuted: string;
  info: string;
  infoMuted: string;
  glassBg: string;
  glassBorder: string;
  statusIdle: string;
  statusAssigned: string;
  statusThinking: string;
  statusSearching: string;
  statusExecuting: string;
  statusMeeting: string;
  statusBlocked: string;
  statusWaiting: string;
  statusReporting: string;
  statusSuccess: string;
  statusFailed: string;
  statusPaused: string;
}

/**
 * Semantic color source of truth. Dark values preserve the previous web CSS
 * variables and Studio values where they overlap; light values are the paired
 * AA-contrast theme.
 */
export const DARK_SEMANTIC_COLORS: SemanticColors = {
  surface: '#0c1118',
  surfaceElevated: '#151d2e',
  surfaceMuted: '#1e293b',
  surfaceHover: '#334155',
  surfaceActive: '#3b4862',
  textPrimary: '#f1f5f9',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
  textDisabled: '#475569',
  textInverse: '#0c1118',
  borderSubtle: 'rgba(255,255,255,0.06)',
  borderDefault: 'rgba(255,255,255,0.10)',
  borderStrong: 'rgba(255,255,255,0.18)',
  borderFocus: 'rgba(59,130,246,0.55)',
  accent: '#3b82f6',
  accentHover: '#2563eb',
  accentMuted: 'rgba(59,130,246,0.18)',
  accentText: '#93c5fd',
  success: '#10b981',
  successMuted: 'rgba(16,185,129,0.15)',
  warning: '#f59e0b',
  warningMuted: 'rgba(245,158,11,0.15)',
  error: '#ef4444',
  errorMuted: 'rgba(239,68,68,0.15)',
  info: '#3b82f6',
  infoMuted: 'rgba(59,130,246,0.15)',
  glassBg: 'rgba(0,0,0,0.40)',
  glassBorder: 'rgba(255,255,255,0.10)',
  statusIdle: '#94a3b8',
  statusAssigned: '#60a5fa',
  statusThinking: '#818cf8',
  statusSearching: '#c084fc',
  statusExecuting: '#34d399',
  statusMeeting: '#a78bfa',
  statusBlocked: '#f87171',
  statusWaiting: '#fbbf24',
  statusReporting: '#2dd4bf',
  statusSuccess: '#4ade80',
  statusFailed: '#ef4444',
  statusPaused: '#9ca3af',
};

export const LIGHT_SEMANTIC_COLORS: SemanticColors = {
  surface: '#fafbfc',
  surfaceElevated: '#ffffff',
  surfaceMuted: '#f1f5f9',
  surfaceHover: '#e2e8f0',
  surfaceActive: '#cbd5e1',
  textPrimary: '#0f172a',
  textSecondary: '#475569',
  textMuted: '#64748b',
  textDisabled: '#94a3b8',
  textInverse: '#ffffff',
  borderSubtle: 'rgba(15,23,42,0.06)',
  borderDefault: 'rgba(15,23,42,0.12)',
  borderStrong: 'rgba(15,23,42,0.20)',
  borderFocus: 'rgba(37,99,235,0.55)',
  accent: '#2563eb',
  accentHover: '#1d4ed8',
  accentMuted: 'rgba(37,99,235,0.12)',
  accentText: '#1e40af',
  success: '#059669',
  successMuted: 'rgba(5,150,105,0.12)',
  warning: '#d97706',
  warningMuted: 'rgba(217,119,6,0.12)',
  error: '#dc2626',
  errorMuted: 'rgba(220,38,38,0.12)',
  info: '#2563eb',
  infoMuted: 'rgba(37,99,235,0.12)',
  glassBg: 'rgba(255,255,255,0.65)',
  glassBorder: 'rgba(15,23,42,0.10)',
  statusIdle: '#64748b',
  statusAssigned: '#2563eb',
  statusThinking: '#4f46e5',
  statusSearching: '#9333ea',
  statusExecuting: '#059669',
  statusMeeting: '#7c3aed',
  statusBlocked: '#dc2626',
  statusWaiting: '#d97706',
  statusReporting: '#0d9488',
  statusSuccess: '#16a34a',
  statusFailed: '#dc2626',
  statusPaused: '#64748b',
};

export function getSemanticColors(theme: 'light' | 'dark'): SemanticColors {
  return theme === 'light' ? LIGHT_SEMANTIC_COLORS : DARK_SEMANTIC_COLORS;
}
