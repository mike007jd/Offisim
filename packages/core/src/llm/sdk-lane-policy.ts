/**
 * Single source of truth for the message we surface when an `*-agent-sdk`
 * lane receives a tool-bearing LlmRequest. Offisim keeps provider SDK lanes
 * text/reasoning-only; tool-capable work needs the default harness/gateway
 * path or a separately verified employee runtime profile.
 */
export function sdkLaneTextOnlyMessage(laneLabel: string): string {
  return `${laneLabel} lane is text/reasoning-only in Offisim and does not execute file, shell, or virtual tool calls. Use the default Offisim harness/gateway tools or a verified tool-capable employee profile for tool work.`;
}
