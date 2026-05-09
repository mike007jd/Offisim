/**
 * Single source of truth for the message we surface when an `*-agent-sdk`
 * transport receives a tool-bearing LlmRequest without a verified runtime
 * profile. Model transport is not a product lane; tool-capable work needs the
 * default harness/gateway path or a separately verified employee runtime profile.
 */
export function sdkLaneTextOnlyMessage(laneLabel: string): string {
  return `${laneLabel} model transport is not a tool-capable Offisim runtime. It cannot execute file, shell, or virtual tool calls without a verified employee runtime profile. Use the default Offisim harness/gateway tools or a verified tool-capable employee profile for tool work.`;
}
