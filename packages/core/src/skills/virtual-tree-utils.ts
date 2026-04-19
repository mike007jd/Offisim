import type { VirtualTree } from './skill-source-resolvers/types.js';

/**
 * Narrow a `VirtualTree` to a subtree rooted at `subpath`. Paths in the result
 * are rewritten relative to the new root so the scanner sees SKILL.md at
 * depth 1. Returns a tree with zero files when the subpath doesn't exist —
 * callers turn that into a structured `*-subpath-not-found` error.
 *
 * Normalizes by trimming leading/trailing slashes and `./` segments so callers
 * can pass `do-research`, `/do-research`, `./do-research/`, etc.
 */
export function subtreeOf(tree: VirtualTree, subpath: string): VirtualTree {
  const normalized = subpath.replace(/^\.?\/+/u, '').replace(/\/+$/u, '');
  if (normalized.length === 0) return tree;
  const prefix = `${normalized}/`;
  const files = tree.files
    .filter((f) => f.path.startsWith(prefix))
    .map((f) => ({ path: f.path.slice(prefix.length), content: f.content }));
  return { files };
}

/**
 * List first-level directory names in a tree. Used to surface "pick a subpath"
 * candidates when the scanner reports `ambiguous` on a monorepo-style archive.
 */
export function firstLevelDirs(tree: VirtualTree): string[] {
  const set = new Set<string>();
  for (const f of tree.files) {
    const idx = f.path.indexOf('/');
    if (idx > 0) set.add(f.path.slice(0, idx));
  }
  return [...set].sort();
}
