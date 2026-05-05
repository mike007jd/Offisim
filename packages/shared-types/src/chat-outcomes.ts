export const ATTACHMENTS_REQUIRE_GATEWAY_LANE = 'attachments-require-gateway-lane' as const;
export const LOCAL_TOOLS_REQUIRE_GATEWAY_LANE = 'local-tools-require-gateway-lane' as const;

export type ChatRuntimeOutcomeKind =
  | typeof ATTACHMENTS_REQUIRE_GATEWAY_LANE
  | typeof LOCAL_TOOLS_REQUIRE_GATEWAY_LANE;

const CHAT_RUNTIME_OUTCOME_KINDS = new Set<string>([
  ATTACHMENTS_REQUIRE_GATEWAY_LANE,
  LOCAL_TOOLS_REQUIRE_GATEWAY_LANE,
]);

export function isChatRuntimeOutcomeKind(value: unknown): value is ChatRuntimeOutcomeKind {
  return typeof value === 'string' && CHAT_RUNTIME_OUTCOME_KINDS.has(value);
}
