import type { RuntimeRepositories } from '@offisim/core/browser';
import { Input, Textarea, cn } from '@offisim/ui-core';
import { useEffect, useRef, useState } from 'react';
import { parseCompanyDescription, updateCompanyIdentity } from '../../lib/company-identity.js';
import {
  STUDIO_LABEL_CLASS,
  studioInputClass,
} from './studio-style-helpers.js';

export const STUDIO_IDENTITY_HEIGHT = 56;

interface StudioCompanyIdentityProps {
  mode: 'create' | 'edit';
  companyId: string | undefined;
  repos: RuntimeRepositories | null;
  onError: (message: string) => void;
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
    <div className="absolute left-60 right-60 top-11 z-sticky flex h-14 items-center gap-sp-3 border-b border-line bg-surface-elevated px-sp-3">
      <div className="flex shrink-0 items-center gap-sp-2">
        <span className={STUDIO_LABEL_CLASS}>Company</span>
        <Input
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
          className={`${studioInputClass(nameFocused)} w-60`}
        />
      </div>

      <div className="relative flex min-w-0 flex-1 items-center gap-sp-2">
        <span className={STUDIO_LABEL_CLASS}>Description</span>
        {isCreate ? (
          <span
            className={`${studioInputClass(false)} flex flex-1 cursor-not-allowed select-none items-center italic text-ink-4`}
            aria-label="Company description (set after first save)"
          >
            Set after first save
          </span>
        ) : (
          <Textarea
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
            className={cn(
              `${studioInputClass(descFocused)} w-full flex-1 resize-none leading-snug`,
              descFocused &&
                'absolute inset-x-0 top-2 z-elevated h-24 py-sp-1 shadow-elev-2',
            )}
          />
        )}
      </div>
    </div>
  );
}
