import type { AssetKind, PackageManifest } from '@offisim/asset-schema';
import type { MyCreatorProfile, PublishDraft, SubmitResponse } from '@offisim/registry-client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRegistryClient } from './useRegistryClient.js';

export interface PublishDraftInput {
  readonly kind: AssetKind;
  readonly title: string;
  readonly summary: string;
  readonly manifest: PackageManifest;
  readonly artifactUrl: string;
  readonly submitMessage?: string;
}

export interface UsePublishResult {
  readonly drafts: PublishDraft[];
  readonly creator: MyCreatorProfile | null;
  readonly isLoading: boolean;
  readonly isSubmitting: boolean;
  readonly error: string | null;
  readonly refreshDrafts: () => Promise<void>;
  readonly submitDraft: (input: PublishDraftInput) => Promise<SubmitResponse>;
}

export function usePublish(authToken?: string | null): UsePublishResult {
  const client = useRegistryClient(authToken);
  const [drafts, setDrafts] = useState<PublishDraft[]>([]);
  const [creator, setCreator] = useState<MyCreatorProfile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshDrafts = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [draftResponse, creatorResponse] = await Promise.all([
        client.listMyDrafts(),
        client.getMyCreatorProfile(),
      ]);
      setDrafts(draftResponse.drafts);
      setCreator(creatorResponse.creator);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load publish drafts');
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [draftResponse, creatorResponse] = await Promise.all([
          client.listMyDrafts(),
          client.getMyCreatorProfile(),
        ]);
        if (!cancelled) {
          setDrafts(draftResponse.drafts);
          setCreator(creatorResponse.creator);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load publish drafts');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const submitDraft = useCallback(
    async (input: PublishDraftInput) => {
      setIsSubmitting(true);
      setError(null);

      try {
        const draft = await client.createPublishDraft({
          kind: input.kind,
          title: input.title,
          summary: input.summary,
          artifact_upload_mode: 'external_url',
        });

        await client.putDraftManifest(draft.draft_id, {
          manifest_json: input.manifest as unknown as Record<string, unknown>,
          artifact: {
            storage_backend: 'external_url',
            external_url: input.artifactUrl,
          },
        });

        const response = await client.submitPublishDraft({
          draft_id: draft.draft_id,
          submit_message: input.submitMessage,
        });

        await refreshDrafts();
        return response;
      } catch (err) {
        const nextError = err instanceof Error ? err.message : 'Failed to submit draft';
        setError(nextError);
        throw err;
      } finally {
        setIsSubmitting(false);
      }
    },
    [client, refreshDrafts],
  );

  return useMemo(
    () => ({
      drafts,
      creator,
      isLoading,
      isSubmitting,
      error,
      refreshDrafts,
      submitDraft,
    }),
    [creator, drafts, error, isLoading, isSubmitting, refreshDrafts, submitDraft],
  );
}
