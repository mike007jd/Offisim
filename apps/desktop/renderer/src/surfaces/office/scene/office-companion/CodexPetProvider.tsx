import { useUiState } from '@/app/ui-state.js';
import { queryKeys } from '@/data/query-keys.js';
import {
  type CodexPetCatalog,
  type CodexPetMetadata,
  invokeCommand,
} from '@/lib/tauri-commands.js';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react';

interface CodexPetContextValue {
  readonly catalog: CodexPetCatalog | null;
  readonly catalogError: string | null;
  readonly catalogLoading: boolean;
  readonly selectedPet: CodexPetMetadata | null;
  readonly atlasUrl: string | null;
  readonly atlasError: string | null;
  readonly selectPet: (petId: string) => void;
  readonly refresh: () => Promise<void>;
}

const CodexPetContext = createContext<CodexPetContextValue | null>(null);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function commandBytes(value: ArrayBuffer | Uint8Array | number[]): Uint8Array<ArrayBuffer> {
  const source =
    value instanceof Uint8Array
      ? value
      : value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : Uint8Array.from(value);
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy;
}

export function resolveCodexPet(
  pets: readonly CodexPetMetadata[],
  selectedPetId: string | null,
  codexSelectedPetId: string | null | undefined,
): CodexPetMetadata | null {
  return (
    pets.find((pet) => pet.id === selectedPetId) ??
    pets.find((pet) => pet.id === codexSelectedPetId) ??
    pets[0] ??
    null
  );
}

export function CodexPetProvider({ children }: { readonly children: ReactNode }) {
  const enabled = useUiState((state) => state.officeCompanionEnabled);
  const selectedPetId = useUiState((state) => state.officeCompanionPetId);
  const setSelectedPetId = useUiState((state) => state.setOfficeCompanionPetId);
  const catalogQuery = useQuery({
    queryKey: queryKeys.codexPets(),
    queryFn: () => invokeCommand('codex_pets_list'),
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    staleTime: 5_000,
  });
  const pets = catalogQuery.data?.pets ?? [];
  const selectedPet = resolveCodexPet(pets, selectedPetId, catalogQuery.data?.selectedPetId);

  useEffect(() => {
    if (!catalogQuery.isSuccess) return;
    if (selectedPet?.id !== selectedPetId) setSelectedPetId(selectedPet?.id ?? null);
  }, [catalogQuery.isSuccess, selectedPet?.id, selectedPetId, setSelectedPetId]);

  const [atlas, setAtlas] = useState<{
    readonly key: string;
    readonly url: string;
  } | null>(null);
  const [atlasError, setAtlasError] = useState<string | null>(null);
  const atlasPetId = selectedPet?.id ?? null;
  const atlasPetVersion = selectedPet?.version ?? null;

  useEffect(() => {
    setAtlas(null);
    setAtlasError(null);
    if (!enabled || !atlasPetId || !atlasPetVersion) return;

    const key = `${atlasPetId}:${atlasPetVersion}`;
    let active = true;
    let objectUrl: string | null = null;
    void invokeCommand('codex_pet_load', {
      petId: atlasPetId,
      expectedVersion: atlasPetVersion,
    })
      .then((raw) => {
        objectUrl = URL.createObjectURL(new Blob([commandBytes(raw)], { type: 'image/webp' }));
        if (active) setAtlas({ key, url: objectUrl });
        else URL.revokeObjectURL(objectUrl);
      })
      .catch((error: unknown) => {
        if (active) setAtlasError(errorMessage(error));
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [atlasPetId, atlasPetVersion, enabled]);

  const value = useMemo<CodexPetContextValue>(
    () => ({
      catalog: catalogQuery.data ?? null,
      catalogError: catalogQuery.error ? errorMessage(catalogQuery.error) : null,
      catalogLoading: catalogQuery.isLoading,
      selectedPet,
      atlasUrl: atlas?.key === `${selectedPet?.id}:${selectedPet?.version}` ? atlas.url : null,
      atlasError,
      selectPet: setSelectedPetId,
      refresh: async () => {
        const result = await catalogQuery.refetch();
        if (result.isError) throw result.error;
      },
    }),
    [
      atlas,
      atlasError,
      catalogQuery.data,
      catalogQuery.error,
      catalogQuery.isLoading,
      catalogQuery.refetch,
      selectedPet,
      setSelectedPetId,
    ],
  );

  return <CodexPetContext.Provider value={value}>{children}</CodexPetContext.Provider>;
}

export function useCodexPet(): CodexPetContextValue {
  const context = useContext(CodexPetContext);
  if (!context) throw new Error('useCodexPet must be used within CodexPetProvider');
  return context;
}
