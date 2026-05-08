import type {
  LlmGateway,
  LlmRequest,
  LlmResponse,
  LlmStreamChunk,
  ToolCallResult,
} from '../llm/gateway.js';

export interface FakeGatewayTurnMatch {
  readonly contains?: string;
  readonly toolNames?: readonly string[];
  readonly absentToolNames?: readonly string[];
}

export interface FakeGatewayTurn {
  readonly id: string;
  readonly match?: FakeGatewayTurnMatch;
  readonly response: LlmResponse;
  readonly streamChunks?: readonly LlmStreamChunk[];
}

export interface FakeGatewayAbortHarness {
  abortController(): AbortController | null;
  shouldAbortTurn(turnId: string): boolean;
}

export class FakeGateway implements LlmGateway {
  private cursor = 0;
  readonly requests: LlmRequest[] = [];

  constructor(
    private readonly turns: readonly FakeGatewayTurn[],
    private readonly abortHarness?: FakeGatewayAbortHarness,
  ) {}

  async chat(request: LlmRequest): Promise<LlmResponse> {
    throwIfAborted(request.signal);
    this.requests.push(request);
    const turn = this.next(request);
    this.abortTurnIfConfigured(turn, request.signal);
    return turn.response;
  }

  async *chatStream(request: LlmRequest): AsyncIterable<LlmStreamChunk> {
    throwIfAborted(request.signal);
    this.requests.push(request);
    const turn = this.next(request);
    this.abortTurnIfConfigured(turn, request.signal);
    if (turn.streamChunks) {
      for (const chunk of turn.streamChunks) {
        throwIfAborted(request.signal);
        yield chunk;
      }
      return;
    }

    if (turn.response.content) {
      yield { content: turn.response.content, done: false };
    }
    if (turn.response.reasoningContent) {
      yield { reasoning: turn.response.reasoningContent, done: false };
    }
    yield {
      done: true,
      toolCalls: [...turn.response.toolCalls],
      usage: turn.response.usage,
    };
  }

  dispose(): void {}

  private next(request: LlmRequest): FakeGatewayTurn {
    const turn = this.turns[this.cursor];
    this.cursor += 1;
    if (!turn) {
      throw new Error(`FakeGateway exhausted at request ${this.cursor}`);
    }
    assertTurnMatch(turn, request);
    return turn;
  }

  private abortTurnIfConfigured(turn: FakeGatewayTurn, signal: AbortSignal | undefined): void {
    if (!this.abortHarness?.shouldAbortTurn(turn.id)) return;
    const reason = new DOMException(
      `Harness cancelled LLM turn "${turn.id}".`,
      'AbortError',
    );
    this.abortHarness.abortController()?.abort(reason);
    throw abortErrorFromSignal(signal, reason);
  }
}

function assertTurnMatch(turn: FakeGatewayTurn, request: LlmRequest): void {
  if (!hasMatchConstraint(turn.match)) {
    throw new Error(`FakeGateway turn ${turn.id} is missing prompt/tool match constraints`);
  }
  if (turn.match.contains) {
    const joinedMessages = request.messages.map((message) => message.content).join('\n');
    if (!joinedMessages.includes(turn.match.contains)) {
      throw new Error(
        `FakeGateway turn ${turn.id} expected prompt to contain "${turn.match.contains}"`,
      );
    }
  }
  if (turn.match.toolNames) {
    const actual = new Set((request.tools ?? []).map((tool) => tool.name));
    const missing = turn.match.toolNames.filter((name) => !actual.has(name));
    if (missing.length > 0) {
      throw new Error(`FakeGateway turn ${turn.id} missing tools: ${missing.join(', ')}`);
    }
  }
  if (turn.match.absentToolNames) {
    const actual = new Set((request.tools ?? []).map((tool) => tool.name));
    const present = turn.match.absentToolNames.filter((name) => actual.has(name));
    if (present.length > 0) {
      throw new Error(
        `FakeGateway turn ${turn.id} unexpectedly exposed tools: ${present.join(', ')}`,
      );
    }
  }
}

function hasMatchConstraint(
  match: FakeGatewayTurnMatch | undefined,
): match is FakeGatewayTurnMatch {
  return Boolean(
    (match?.contains && match.contains.length > 0) ||
      (match?.toolNames && match.toolNames.length > 0) ||
      (match?.absentToolNames && match.absentToolNames.length > 0),
  );
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw abortErrorFromSignal(signal, new DOMException('Aborted', 'AbortError'));
}

function abortErrorFromSignal(signal: AbortSignal | undefined, fallback: DOMException): Error {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  if (typeof reason === 'string') return new DOMException(reason, 'AbortError');
  return fallback;
}

export function fakeResponse(
  content: string,
  options: {
    readonly toolCalls?: readonly ToolCallResult[];
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly reasoningContent?: string;
  } = {},
): LlmResponse {
  return {
    content,
    ...(options.reasoningContent ? { reasoningContent: options.reasoningContent } : {}),
    toolCalls: [...(options.toolCalls ?? [])],
    usage: {
      inputTokens: options.inputTokens ?? 0,
      outputTokens: options.outputTokens ?? 0,
    },
  };
}
