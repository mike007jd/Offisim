// Whole-team intent detection shared by manager-node (fan recommended
// employees out to the whole team) and pm-planner-node (force recommended-
// employee coverage). Both must agree on what "whole team" means, or the
// manager could fan out while the planner silently drops members. This is a
// distinct vocabulary from the local-tool routing intent in task-tool-intent.ts
// (which is the SSOT for that orthogonal concern), so it lives on its own.

/**
 * True when `text` asks for the whole team and there is more than one member
 * to fan out to (`memberCount > 1`). Matches English and Chinese phrasings plus
 * count-based references like "5 employees" / "5 个员工".
 */
export function detectWholeTeamIntent(text: string, memberCount: number): boolean {
  if (memberCount <= 1) return false;
  return (
    /\b(all|everyone|whole team|entire team|all employees|team-wide)\b/i.test(text) ||
    /全员|所有员工|整个团队|全团队|共同合作|一起合作|分成\s*[一二三四五六七八九十0-9]+\s*组/u.test(
      text,
    ) ||
    /完整办公室团队|办公室团队/u.test(text) ||
    new RegExp(`\\b${memberCount}\\s*(employees|people|members)\\b`, 'i').test(text) ||
    new RegExp(`${memberCount}\\s*(个|位)?\\s*(员工|成员|人)`, 'u').test(text)
  );
}
