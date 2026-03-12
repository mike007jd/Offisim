/**
 * Skill validator — check OpenClaw skill requirements against the runtime environment.
 *
 * Validation has two tiers:
 *   - Hard errors (valid:false): empty name, empty instructions, size limits
 *   - Soft warnings (valid:true): binary/env/config/OS checks the environment can't verify
 */

import type { SupportedEnvironment } from '@aics/asset-schema';
import type { ParsedSkill, SkillValidationIssue, SkillValidationResult } from './types.js';

/**
 * Validate a parsed skill's requirements against the current environment.
 *
 * Returns errors for hard failures (blocks install) and warnings for soft issues.
 * In browser mode, bin/env/config checks always warn (can't verify).
 * In desktop mode, OS check passes (assumes correct OS), bin/env/config still warn.
 *
 * @param skill - The parsed skill to validate.
 * @param environment - Current runtime environment type.
 * @returns SkillValidationResult with errors and warnings.
 */
export function validateSkill(
  skill: ParsedSkill,
  environment: SupportedEnvironment,
  connectedMcpServers?: ReadonlySet<string>,
): SkillValidationResult {
  const errors: SkillValidationIssue[] = [];
  const warnings: SkillValidationIssue[] = [];

  // Hard errors
  if (!skill.name || skill.name.trim().length === 0) {
    errors.push({ type: 'empty_name', detail: 'Skill name is required', severity: 'error' });
  }
  if (skill.name && skill.name.length > 128) {
    errors.push({ type: 'name_too_long', detail: 'Skill name must be <= 128 characters', severity: 'error' });
  }
  if (!skill.instructions || skill.instructions.trim().length === 0) {
    errors.push({ type: 'empty_instructions', detail: 'Skill instructions are required', severity: 'error' });
  }
  if (skill.instructions && skill.instructions.length > 512 * 1024) {
    errors.push({ type: 'instructions_too_large', detail: 'Instructions exceed 512KB limit', severity: 'error' });
  }

  // Soft warnings (existing logic preserved, add severity: 'warning')
  if (skill.requirements.bins) {
    for (const bin of skill.requirements.bins) {
      warnings.push({
        type: 'missing_bin',
        detail: `Skill requires binary "${bin}" — cannot verify in ${environment} environment`,
        severity: 'warning',
      });
    }
  }
  if (skill.requirements.env) {
    for (const envVar of skill.requirements.env) {
      warnings.push({
        type: 'missing_env',
        detail: `Skill requires environment variable "${envVar}" — cannot verify in ${environment} environment`,
        severity: 'warning',
      });
    }
  }
  if (skill.requirements.config) {
    for (const configPath of skill.requirements.config) {
      warnings.push({
        type: 'missing_config',
        detail: `Skill requires config file "${configPath}" — cannot verify in ${environment} environment`,
        severity: 'warning',
      });
    }
  }
  if (skill.metadata.os && skill.metadata.os.length > 0 && environment !== 'desktop') {
    warnings.push({
      type: 'unsupported_os',
      detail: `Skill targets OS: ${skill.metadata.os.join(', ')}. Running in ${environment} — OS compatibility unverified.`,
      severity: 'warning',
    });
  }

  // MCP server warnings
  if (skill.requirements.mcps && connectedMcpServers) {
    for (const mcp of skill.requirements.mcps) {
      if (!connectedMcpServers.has(mcp.name)) {
        warnings.push({
          type: 'missing_mcp',
          detail: `Skill requires MCP server "${mcp.name}" (${mcp.description}). Configure in Settings → MCP Servers.`,
          severity: 'warning',
        });
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
