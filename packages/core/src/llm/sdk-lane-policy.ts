/**
 * Single source of truth for the message we surface when an `*-agent-sdk`
 * lane receives a tool-bearing LlmRequest. Offisim 1.0 keeps SDK lanes
 * text/reasoning-only — file/shell/virtual tool execution is gateway-only.
 */
export function sdkLaneTextOnlyMessage(laneLabel: string): string {
  return `${laneLabel} lane is text/reasoning-only in Offisim and does not execute file, shell, or virtual tool calls. Switch this employee to gateway lane to use tools.`;
}
