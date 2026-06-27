/**
 * DR-002 — Runtime compatibility hash (PRD §34-Q5, §29 Compatibility, slice M4).
 *
 * The hash answers one question on resume: "is the runtime that would resume this
 * mission compatible with the runtime that interrupted it?" PRD §29 Compatibility:
 * a resume MUST be blocked when the runtime is incompatible, not blindly retried.
 * The hash is the deterministic fingerprint we compare; it is stored on
 * `runtime_session_link.compatibility_hash` at session start (MS-001 schema) and
 * re-derived at resume.
 *
 * Resources covered (PRD §34-Q5): SDK id + version, extension ids + versions,
 * tool ids, skill ids, system-prompt version. Determinism comes from a STABLE
 * canonical serialization: every id list is sorted, extensions sort by id, and
 * the result is one JSON shape with fixed key order — so reordering the inputs
 * cannot change the hash. The digest reuses the core {@link sha256Text} util.
 *
 * Additive at M4 — pure logic; live session-start / resume wiring is the M-pass.
 */

import { sha256Text } from '../../../utils/hash.js';

/** A single runtime extension's identity (id + version) — §34-Q5. */
export interface RuntimeExtensionRef {
  id: string;
  version: string;
}

/**
 * The resource set the compatibility hash is derived from (PRD §34-Q5). The host
 * gathers these from the runtime at session start and again at resume.
 */
export interface CompatibilityResources {
  /** Runtime SDK id (e.g. `pi`). */
  sdkId: string;
  /** Runtime SDK version (e.g. `0.79.8`). */
  sdkVersion: string;
  /** Loaded extensions (id + version each). Order-insensitive. */
  extensions: RuntimeExtensionRef[];
  /** Tool ids available to the session. Order-insensitive. */
  toolIds: string[];
  /** Skill ids available to the session. Order-insensitive. */
  skillIds: string[];
  /** The system-prompt version that framed the session. */
  systemPromptVersion: string;
}

/** Stable, sorted, canonical serialization of the §34-Q5 resources. */
function canonicalize(resources: CompatibilityResources): string {
  const extensions = [...resources.extensions]
    .map((e) => ({ id: e.id, version: e.version }))
    .sort((a, b) =>
      a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : a.version < b.version
            ? -1
            : a.version > b.version
              ? 1
              : 0,
    );
  const canonical = {
    sdkId: resources.sdkId,
    sdkVersion: resources.sdkVersion,
    extensions,
    toolIds: [...resources.toolIds].sort(),
    skillIds: [...resources.skillIds].sort(),
    systemPromptVersion: resources.systemPromptVersion,
  };
  return JSON.stringify(canonical);
}

/**
 * Deterministic compatibility hash over the §34-Q5 resources. Stable under
 * reordering of extensions / tool ids / skill ids (each is sorted first). Returns
 * the {@link sha256Text} prefixed hex (e.g. `sha256:...`); identical inputs in any
 * order yield an identical string.
 */
export function computeCompatibilityHash(resources: CompatibilityResources): Promise<string> {
  return sha256Text(canonicalize(resources));
}

/**
 * PRD §29 Compatibility: whether a stored hash matches the current one. A `null`
 * stored hash (a session started before a hash was recorded) is treated as NOT
 * compatible — we never assume compatibility we cannot prove, so resume is gated
 * to user confirmation rather than blindly attempted.
 */
export function isCompatible(stored: string | null | undefined, current: string): boolean {
  return stored != null && stored === current;
}
