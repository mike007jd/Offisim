import type {
  ScannedSkill,
  SkillResolverError,
  VirtualTree,
} from './skill-source-resolvers/types.js';

/**
 * Walks a virtual tree and returns the canonical skill root. A "skill root"
 * is the directory containing SKILL.md. We accept two layouts:
 *
 *   1. SKILL.md at the tree root.
 *   2. SKILL.md inside a single top-level subdirectory; sibling `scripts/` /
 *      `references/` / `assets/` within that subdirectory are included as the
 *      skill's asset paths.
 *
 * If the tree contains multiple candidate SKILL.md files the scanner returns
 * a structured error with `candidates` so the caller can surface a picker to
 * the LLM instead of picking blind.
 */
export function scanSkillDir(tree: VirtualTree): ScannedSkill | SkillResolverError {
  const candidates: string[] = [];
  for (const f of tree.files) {
    const lower = f.path.toLowerCase();
    if (lower.endsWith('skill.md')) {
      const depth = f.path.split('/').filter((s) => s.length > 0).length;
      if (depth === 1 || depth === 2) {
        candidates.push(f.path);
      }
    }
  }
  if (candidates.length === 0) {
    return {
      kind: 'skill-scanner-missing',
      message: 'No SKILL.md found at the archive root or in a single subdirectory.',
    };
  }
  if (candidates.length > 1) {
    return {
      kind: 'skill-scanner-ambiguous',
      message: 'Multiple SKILL.md files found.',
      candidates: candidates.map((p) => ({ path: p.replace(/\/?SKILL\.md$/iu, '/') })),
    };
  }

  const [skillMd] = candidates;
  if (!skillMd) {
    return {
      kind: 'skill-scanner-missing',
      message: 'No SKILL.md found at the archive root or in a single subdirectory.',
    };
  }
  const root = skillMd.replace(/\/?SKILL\.md$/iu, '');
  const assetPaths: string[] = [];
  const rootPrefix = root.length > 0 ? `${root}/` : '';
  for (const f of tree.files) {
    if (f.path === skillMd) continue;
    if (rootPrefix.length > 0 && !f.path.startsWith(rootPrefix)) continue;
    const rel = f.path.slice(rootPrefix.length);
    if (rel.startsWith('scripts/') || rel.startsWith('references/') || rel.startsWith('assets/')) {
      assetPaths.push(rel);
    }
  }

  return {
    root,
    skillMdPath: skillMd,
    assetPaths,
  };
}
