import type { LocalDirAdapter } from './skill-source-resolvers/claude-code.js';
import type {
  GitCloneAdapter,
  GitHttpFetch,
  GitLocalFsAdapter,
} from './skill-source-resolvers/git.js';

/**
 * Runtime-specific IO adapters for the agent-mediated skill install path.
 * Core stays runtime-agnostic; each runtime (Web / Tauri desktop / tests) wires
 * the subset it supports and leaves the rest undefined. Resolvers that need a
 * missing adapter return a structured `not-supported-in-web` error, never a
 * thrown exception.
 */
export interface SkillInstallEnvironment {
  runtime: 'desktop' | 'web';
  httpFetch: GitHttpFetch;
  clone?: GitCloneAdapter | undefined;
  gitFs?: GitLocalFsAdapter | undefined;
  localDir?: LocalDirAdapter | undefined;
  /** Optional current-repo root — forwarded to sync resolvers so they can scan `.claude/skills/`. */
  repoRoot?: string | undefined;
  /**
   * Upload payload lookup. The chat / UI layer puts the user-selected file
   * here (keyed by `fileRef`) before the LLM issues `install_skill_from_upload`;
   * the tool handler consumes it by ref.
   */
  uploadResolver?: UploadRefResolver | undefined;
}

export interface UploadRefResolver {
  /** Return filename + bytes for a given ref, or `null` if the ref is unknown / already consumed. */
  resolve(fileRef: string): Promise<{ filename: string; bytes: Uint8Array } | null>;
}
