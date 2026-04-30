import type { RuntimeRepositories } from '@offisim/core/browser';
import { useEffect, useRef, useState } from 'react';
import { parseCompanyDescription, updateCompanyIdentity } from '../../lib/company-identity.js';
import {
  FONT,
  LAYOUT,
  SP,
  STUDIO_COLORS,
  STUDIO_Z_INDEX,
  inputStyle,
} from './studio-style-helpers.js';

export const STUDIO_IDENTITY_HEIGHT = 56;

interface StudioCompanyIdentityProps {
  mode: 'create' | 'edit';
  companyId: string | undefined;
  repos: RuntimeRepositories | null;
  onError: (message: string) => void;
}

const CONTAINER_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: LAYOUT.toolbarHeight,
  left: LAYOUT.paletteWidth,
  right: LAYOUT.propertiesWidth,
  height: STUDIO_IDENTITY_HEIGHT,
  display: 'flex',
  alignItems: 'center',
  gap: SP.md,
  padding: `0 ${SP.md}px`,
  background: STUDIO_COLORS.surface0,
  borderBottom: `1px solid ${STUDIO_COLORS.border}`,
  fontFamily: FONT.family,
  zIndex: STUDIO_Z_INDEX.sticky,
};

const FIELD_LABEL_STYLE: React.CSSProperties = {
  fontSize: FONT.xs,
  fontWeight: FONT.semibold,
  letterSpacing: 0,
  textTransform: 'uppercase' as const,
  color: STUDIO_COLORS.textTertiary,
  flexShrink: 0,
};

function descriptionStyle(focused: boolean): React.CSSProperties {
  const base = inputStyle(focused);
  if (!focused) {
    return { ...base, width: '100%', height: 32, resize: 'none', lineHeight: 1.4 };
  }
  return {
    ...base,
    width: '100%',
    height: 100,
    resize: 'none',
    lineHeight: 1.4,
    paddingTop: SP.xs,
    paddingBottom: SP.xs,
    position: 'absolute',
    top: 8,
    left: 0,
    right: 0,
    zIndex: STUDIO_Z_INDEX.elevated,
    boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
  };
}

export function StudioCompanyIdentity({
  mode,
  companyId,
  repos,
  onError,
}: StudioCompanyIdentityProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [nameFocused, setNameFocused] = useState(false);
  const [descFocused, setDescFocused] = useState(false);

  const originalRef = useRef({ name: '', description: '' });
  const loadedCompanyIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (mode !== 'edit' || !companyId || !repos) return;
    if (loadedCompanyIdRef.current === companyId) return;

    let cancelled = false;
    void (async () => {
      const row = await repos.companies.findById(companyId).catch(() => null);
      if (cancelled || !row) return;

      const desc = parseCompanyDescription(row.default_model_policy_json);
      setName(row.name);
      setDescription(desc);
      originalRef.current = { name: row.name, description: desc };
      loadedCompanyIdRef.current = companyId;
    })();

    return () => {
      cancelled = true;
    };
  }, [mode, companyId, repos]);

  async function commitField(field: 'name' | 'description', draft: string): Promise<void> {
    if (mode !== 'edit' || !companyId || !repos) return;
    const original = originalRef.current[field];

    if (field === 'name') {
      const trimmed = draft.trim();
      if (!trimmed) {
        setName(original);
        return;
      }
      if (trimmed === original) return;
      try {
        await updateCompanyIdentity(repos, companyId, { name: trimmed });
        originalRef.current = { ...originalRef.current, name: trimmed };
        setName(trimmed);
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Failed to save company name');
        setName(original);
      }
      return;
    }

    if (draft === original) return;
    try {
      await updateCompanyIdentity(repos, companyId, { description: draft });
      originalRef.current = { ...originalRef.current, description: draft };
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save company description');
      setDescription(original);
    }
  }

  const isCreate = mode === 'create';

  return (
    <div style={CONTAINER_STYLE}>
      <div style={{ display: 'flex', alignItems: 'center', gap: SP.sm, flexShrink: 0 }}>
        <span style={FIELD_LABEL_STYLE}>Company</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={() => setNameFocused(true)}
          onBlur={() => {
            setNameFocused(false);
            void commitField('name', name);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') {
              e.currentTarget.blur();
            }
          }}
          placeholder={isCreate ? 'Untitled company' : 'Company name'}
          aria-label="Company name"
          style={{ ...inputStyle(nameFocused), width: 240 }}
        />
      </div>

      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: SP.sm,
          minWidth: 0,
          position: 'relative',
        }}
      >
        <span style={FIELD_LABEL_STYLE}>Description</span>
        {isCreate ? (
          <span
            style={{
              ...inputStyle(false),
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              color: STUDIO_COLORS.textDisabled,
              fontStyle: 'italic',
              cursor: 'not-allowed',
              userSelect: 'none',
            }}
            aria-label="Company description (set after first save)"
          >
            Set after first save
          </span>
        ) : (
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onFocus={() => setDescFocused(true)}
            onBlur={() => {
              setDescFocused(false);
              void commitField('description', description);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.currentTarget.blur();
              }
            }}
            placeholder="Describe the operating style, audience, and outcome this company is here to produce."
            aria-label="Company description"
            style={{ ...descriptionStyle(descFocused), flex: 1 }}
          />
        )}
      </div>
    </div>
  );
}
