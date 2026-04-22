## 1. Provider lane model

- [x] 1.1 Extend provider config and preset metadata to represent explicit execution lanes and verified lane support
- [x] 1.2 Update Settings state/controller/UI so trusted runtimes can select `gateway`, `claude-agent-sdk`, or `openai-agents-sdk` only when the active preset supports them
- [x] 1.3 Add migration/fallback behavior for saved configs so retired ACP records and lane-less legacy configs resolve safely

## 2. Claude Agent SDK lane

- [x] 2.1 Add `@anthropic-ai/claude-agent-sdk` and define an Offisim-owned execution adapter boundary for the Claude lane
- [x] 2.2 Implement the Claude lane in backend/trusted runtimes while preserving Offisim LangGraph orchestration ownership
- [x] 2.3 Treat verified Anthropic-compatible providers (starting with MiniMax / Z.AI) as sufficient Claude lane evidence for preset exposure, then validate Kimi / Qwen / other presets one by one

## 3. OpenAI Agents SDK lane

- [x] 3.1 Add the official OpenAI Agents SDK and define the Offisim execution adapter boundary for the OpenAI lane
- [x] 3.2 Implement OpenAI native support first and keep third-party provider support behind explicit verification
- [x] 3.3 Decide whether third-party OpenAI-compatible providers use the direct SDK provider path or an approved adapter path, then expose only the verified presets

## 4. Backend harness verification

- [x] 4.1 Expand harness commands to accept execution lane selection and emit provider × lane summaries
- [x] 4.2 Add smoke/load/edge scenarios for queue depth, timeout, cancellation, tool-calls, unicode, empty input, long context, and provider auth/quota failures
- [x] 4.3 Produce structured verification output that separates Offisim runtime failures from upstream provider failures

## 5. Docs and protocol hygiene

- [x] 5.1 Update canonical specs, CLAUDE docs, and settings copy to describe execution lanes and trusted-runtime gating accurately
- [x] 5.2 Add Anthropic Claude Agent SDK and OpenAI Agents SDK rows to `openspec/protocols-ledger.md`, including repo claim, external posture, and next steps
- [x] 5.3 Record the verified provider-lane matrix in a durable repo location so preset exposure stays tied to real evidence
