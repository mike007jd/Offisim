import { create } from 'zustand';

export type WorkspaceKey = 'office' | 'sops' | 'market' | 'personnel' | 'activity' | 'settings';

interface UiState {
  workspace: WorkspaceKey;
  setWorkspace: (workspace: WorkspaceKey) => void;
}

export const useUiState = create<UiState>((set) => ({
  workspace: 'office',
  setWorkspace: (workspace) => set({ workspace }),
}));
