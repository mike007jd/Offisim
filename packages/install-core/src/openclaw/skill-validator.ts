/**
 * Skill validator — check OpenClaw skill requirements against the runtime environment.
 *
 * MVP scope: Soft validation only (warnings, not hard failures).
 * Browser environment can't actually check for installed binaries or env vars,
 * so we emit warnings. Desktop mode assumes OS matches.
 */

import type { SupportedEnvironment } from '@aics/asset-schema';
import type { ParsedSkill, SkillValidationResult, SkillValidationWarning } from './types.js';

/**
 * Validate a parsed skill's requirements against the current environment.
 *
 * Returns warnings (not errors) — the user decides whether to proceed.
 * In browser mode, bin/env/config checks always warn (can't verify).
 * In desktop mode, OS check passes (assumes correct OS), bin/env/config still warn.
 *
 * @param skill - The parsed skill to validate.
 * @param environment - Current runtime environment type.
 * @returns SkillValidationResult with warnings.
 */
export function validateSkill(
  skill: ParsedSkill,
  environment: SupportedEnvironment,
): SkillValidationResult {
  const warnings: SkillValidationWarning[] = [];

  // Check required binaries
  if (skill.requirements.bins) {
    for (const bin of skill.requirements.bins) {
      warnings.push({
        type: 'missing_bin',
        detail: `Skill requires binary "${bin}" — cannot verify in ${environment} environment`,
      });
    }
  }

  // Check required env vars
  if (skill.requirements.env) {
    for (const envVar of skill.requirements.env) {
      warnings.push({
        type: 'missing_env',
        detail: `Skill requires environment variable "${envVar}" — cannot verify in ${environment} environment`,
      });
    }
  }

  // Check required config files
  if (skill.requirements.config) {
    for (const configPath of skill.requirements.config) {
      warnings.push({
        type: 'missing_config',
        detail: `Skill requires config file "${configPath}" — cannot verify in ${environment} environment`,
      });
    }
  }

  // Check OS compatibility (only in non-desktop environments)
  if (skill.metadata.os && skill.metadata.os.length > 0 && environment !== 'desktop') {
    warnings.push({
      type: 'unsupported_os',
      detail: `Skill targets OS: ${skill.metadata.os.join(', ')}. Running in ${environment} — OS compatibility unverified.`,
    });
  }

  return { valid: true, warnings };
}
