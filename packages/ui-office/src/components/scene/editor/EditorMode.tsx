/**
 * EditorMode — Main editor state manager for the 3D office scene.
 *
 * Manages edit/view mode, placement state, selection, and the array
 * of editor-placed prefabs (local state only — no DB persistence yet).
 *
 * Rendered as a React context provider that wraps the editor UI
 * components (palette, toolbar, properties panel, ghost prefab).
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { PrefabDefinition } from '@aics/shared-types';

// ── localStorage persistence (fallback only) ────────────────────
const STORAGE_KEY = 'aics:editor:placedPrefabs';

/** Callback for persisting editor prefabs to the runtime repository. */
export type SaveToRepoFn = (prefabs: PlacedPrefab[]) => Promise<boolean>;

// ── Types ────────────────────────────────────────────────────────

export type EditorTool = 'select' | 'place';

export interface PlacedPrefab {
  /** Unique instance ID (client-generated). */
  id: string;
  /** PrefabDefinition.prefabId from the builtin catalog. */
  prefabId: string;
  /** World position [x, y, z]. */
  position: [number, number, number];
  /** Rotation in degrees (0/90/180/270). */
  rotation: number;
  /** Zone ID this prefab sits in (for future DB storage). */
  zoneId: string;
}

export interface EditorState {
  /** Current scene mode. */
  mode: 'view' | 'edit';
  /** Active tool when in edit mode. */
  activeTool: EditorTool | null;
  /** The prefab definition being placed (null when not placing). */
  placingPrefab: PrefabDefinition | null;
  /** Instance ID of the currently selected placed prefab. */
  selectedInstanceId: string | null;
  /** All editor-placed prefabs (local state). */
  placedPrefabs: PlacedPrefab[];
}

export interface EditorActions {
  /** Toggle between view and edit mode. */
  toggleMode: () => void;
  /** Set mode explicitly. */
  setMode: (mode: 'view' | 'edit') => void;
  /** Enter placement mode with a prefab definition. */
  startPlacement: (definition: PrefabDefinition) => void;
  /** Cancel placement mode. */
  cancelPlacement: () => void;
  /** Place the current prefab at the given position. */
  placePrefab: (position: [number, number, number], zoneId: string) => void;
  /** Select a placed prefab by instance ID. */
  selectInstance: (id: string | null) => void;
  /** Delete the currently selected prefab. */
  deleteSelected: () => void;
  /** Update position of a placed prefab. */
  updatePosition: (id: string, position: [number, number, number]) => void;
  /** Update rotation of a placed prefab. */
  updateRotation: (id: string, rotation: number) => void;
  /** Reset all editor-placed prefabs. */
  resetAll: () => void;
  /** Persist placed prefabs to repo (or localStorage fallback). Returns true on success. */
  saveLayout: () => Promise<boolean>;
}

// ── Context ──────────────────────────────────────────────────────

const EditorContext = createContext<
  (EditorState & EditorActions) | null
>(null);

export function useEditor() {
  const ctx = useContext(EditorContext);
  if (!ctx) {
    throw new Error('useEditor must be used within <EditorProvider>');
  }
  return ctx;
}

/** Safe version that returns null outside provider (for conditional rendering). */
export function useEditorMaybe() {
  return useContext(EditorContext);
}

// ── Provider ─────────────────────────────────────────────────────

function generateId(): string {
  return `ep-${crypto.randomUUID()}`;
}

interface EditorProviderProps {
  children: React.ReactNode;
  /** When provided, saveLayout writes to the repo instead of just localStorage. */
  saveToRepo?: SaveToRepoFn;
  /** Initial prefabs to load (from DB). Takes precedence over localStorage. */
  initialPrefabs?: PlacedPrefab[];
}

export function EditorProvider({ children, saveToRepo, initialPrefabs }: EditorProviderProps) {
  const [mode, setModeState] = useState<'view' | 'edit'>('view');
  const [activeTool, setActiveTool] = useState<EditorTool | null>(null);
  const [placingPrefab, setPlacingPrefab] = useState<PrefabDefinition | null>(null);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [placedPrefabs, setPlacedPrefabs] = useState<PlacedPrefab[]>(() => {
    if (initialPrefabs && initialPrefabs.length > 0) return initialPrefabs;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? (JSON.parse(stored) as PlacedPrefab[]) : [];
    } catch {
      return [];
    }
  });

  // Refs for stable callbacks — avoids cascade context re-renders on every prefab change
  const placedPrefabsRef = useRef(placedPrefabs);
  placedPrefabsRef.current = placedPrefabs;
  const saveToRepoRef = useRef(saveToRepo);
  saveToRepoRef.current = saveToRepo;

  const toggleMode = useCallback(() => {
    setModeState((prev) => {
      const next = prev === 'view' ? 'edit' : 'view';
      if (next === 'view') {
        // Leaving edit mode — clear placement and selection
        setActiveTool(null);
        setPlacingPrefab(null);
        setSelectedInstanceId(null);
      } else {
        setActiveTool('select');
      }
      return next;
    });
  }, []);

  const setMode = useCallback((m: 'view' | 'edit') => {
    setModeState(m);
    if (m === 'view') {
      setActiveTool(null);
      setPlacingPrefab(null);
      setSelectedInstanceId(null);
    } else {
      setActiveTool('select');
    }
  }, []);

  const startPlacement = useCallback((definition: PrefabDefinition) => {
    setPlacingPrefab(definition);
    setActiveTool('place');
    setSelectedInstanceId(null);
  }, []);

  const cancelPlacement = useCallback(() => {
    setPlacingPrefab(null);
    setActiveTool('select');
  }, []);

  const placePrefab = useCallback((position: [number, number, number], zoneId: string) => {
    if (!placingPrefab) return;
    const newPrefab: PlacedPrefab = {
      id: generateId(),
      prefabId: placingPrefab.prefabId,
      position,
      rotation: 0,
      zoneId,
    };
    setPlacedPrefabs((prev) => [...prev, newPrefab]);
    // Stay in placement mode for rapid placement (click again to place another)
  }, [placingPrefab]);

  const selectInstance = useCallback((id: string | null) => {
    setSelectedInstanceId(id);
    if (id) {
      setActiveTool('select');
      setPlacingPrefab(null);
    }
  }, []);

  const deleteSelected = useCallback(() => {
    if (!selectedInstanceId) return;
    setPlacedPrefabs((prev) => prev.filter((p) => p.id !== selectedInstanceId));
    setSelectedInstanceId(null);
  }, [selectedInstanceId]);

  const updatePosition = useCallback((id: string, position: [number, number, number]) => {
    setPlacedPrefabs((prev) =>
      prev.map((p) => (p.id === id ? { ...p, position } : p)),
    );
  }, []);

  const updateRotation = useCallback((id: string, rotation: number) => {
    setPlacedPrefabs((prev) =>
      prev.map((p) => (p.id === id ? { ...p, rotation } : p)),
    );
  }, []);

  const resetAll = useCallback(() => {
    setPlacedPrefabs([]);
    setSelectedInstanceId(null);
    setPlacingPrefab(null);
    setActiveTool('select');
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }, []);

  const saveLayout = useCallback(async (): Promise<boolean> => {
    const current = placedPrefabsRef.current;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); } catch { /* ignore */ }
    if (saveToRepoRef.current) {
      return saveToRepoRef.current(current);
    }
    return true;
  }, []);

  const value = useMemo(
    () => ({
      mode,
      activeTool,
      placingPrefab,
      selectedInstanceId,
      placedPrefabs,
      toggleMode,
      setMode,
      startPlacement,
      cancelPlacement,
      placePrefab,
      selectInstance,
      deleteSelected,
      updatePosition,
      updateRotation,
      resetAll,
      saveLayout,
    }),
    [
      mode,
      activeTool,
      placingPrefab,
      selectedInstanceId,
      placedPrefabs,
      toggleMode,
      setMode,
      startPlacement,
      cancelPlacement,
      placePrefab,
      selectInstance,
      deleteSelected,
      updatePosition,
      updateRotation,
      resetAll,
      saveLayout,
    ],
  );

  return (
    <EditorContext.Provider value={value}>
      {children}
    </EditorContext.Provider>
  );
}
