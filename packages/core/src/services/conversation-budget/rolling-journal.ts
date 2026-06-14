import type { LlmMessage } from '../../llm/gateway.js';

export interface RollingJournalOptions {
  readonly everyNTurns: number;
  readonly write: (text: string, messages: readonly LlmMessage[]) => Promise<void>;
  readonly summarize: (messages: readonly LlmMessage[]) => Promise<string>;
}

export class RollingJournal {
  private turn = 0;
  private anchor: string | null = null;
  private anchorLocked = false;
  private readonly opts: RollingJournalOptions;

  constructor(opts: RollingJournalOptions) {
    if (!Number.isInteger(opts.everyNTurns) || opts.everyNTurns <= 0) {
      throw new Error('RollingJournal everyNTurns must be a positive integer.');
    }
    this.opts = opts;
  }

  async observeTurn(messages: readonly LlmMessage[]): Promise<void> {
    this.turn += 1;
    this.lockAnchor(messages);

    if (this.turn % this.opts.everyNTurns !== 0) return;

    const summary = await this.opts.summarize(messages);
    if (summary.trim().length === 0) return;
    await this.opts.write(summary, messages);
  }

  anchorText(): string | null {
    return this.anchor;
  }

  currentTurn(): number {
    return this.turn;
  }

  private lockAnchor(messages: readonly LlmMessage[]): void {
    if (this.anchorLocked) return;
    this.anchor = messages.find((message) => message.role === 'user')?.content ?? null;
    this.anchorLocked = true;
  }
}
