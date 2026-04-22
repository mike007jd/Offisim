import type { LlmExecutionLane, LlmProvider } from '@offisim/shared-types';
import { ClaudeAgentSdkAdapter } from './claude-agent-sdk-adapter.js';
import { type GatewayConfig, createGateway } from './gateway-factory.js';
import type { LlmGateway } from './gateway.js';
import { OpenAiAgentsSdkAdapter } from './openai-agents-sdk-adapter.js';
import { assertOpenAiAgentsSdkLaneSupported } from './openai-agents-sdk-lane-policy.js';

const DEFAULT_EXECUTION_LANE: LlmExecutionLane = 'gateway';

export interface ExecutionAdapterConfig extends GatewayConfig {
  executionLane?: LlmExecutionLane;
  cwd?: string;
  pathToClaudeCodeExecutable?: string;
  providerVariantId?: string;
  allowExperimentalOpenAiCompat?: boolean;
}

function assertClaudeProvider(provider: LlmProvider): void {
  if (provider !== 'anthropic') {
    throw new Error(
      `Execution lane "claude-agent-sdk" currently requires provider "anthropic"; received "${provider}".`,
    );
  }
}

export function createExecutionAdapter(config: ExecutionAdapterConfig): LlmGateway {
  switch (config.executionLane ?? DEFAULT_EXECUTION_LANE) {
    case 'gateway':
      return createGateway(config);
    case 'claude-agent-sdk':
      assertClaudeProvider(config.provider);
      return new ClaudeAgentSdkAdapter(config.apiKey, {
        baseURL: config.baseURL,
        cwd: config.cwd,
        pathToClaudeCodeExecutable: config.pathToClaudeCodeExecutable,
        retryConfig: config.retryConfig,
      });
    case 'openai-agents-sdk':
      assertOpenAiAgentsSdkLaneSupported({
        provider: config.provider,
        providerVariantId: config.providerVariantId,
        allowExperimentalCompat: config.allowExperimentalOpenAiCompat,
      });
      return new OpenAiAgentsSdkAdapter(config.apiKey, {
        baseURL: config.baseURL,
        defaultHeaders: config.defaultHeaders,
        retryConfig: config.retryConfig,
        dangerouslyAllowBrowser: config.dangerouslyAllowBrowser,
        fetch: config.fetch,
      });
    default:
      throw new Error(`Unknown execution lane: ${config.executionLane as string}`);
  }
}
