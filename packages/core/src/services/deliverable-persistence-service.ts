import type { DeliverableCreatedPayload, RuntimeEvent } from '@offisim/shared-types';
import type { EventBus } from '../events/event-bus.js';
import type { DeliverableRepository, NewDeliverable } from '../runtime/repositories.js';

const MAX_CONTENT_BYTES = 1_048_576; // 1 MB

export interface DeliverablePersistenceServiceOptions {
  readonly eventBus: EventBus;
  readonly repo?: DeliverableRepository;
}

function byteLength(value: string): number {
  if (typeof Buffer !== 'undefined') {
    return Buffer.byteLength(value, 'utf8');
  }
  return new TextEncoder().encode(value).length;
}

function clampUtf8(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) return value;
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(value, 'utf8');
    return buf.subarray(0, maxBytes).toString('utf8');
  }
  const encoded = new TextEncoder().encode(value);
  return new TextDecoder('utf-8', { fatal: false }).decode(encoded.subarray(0, maxBytes));
}

export function mapPayloadToRow(event: RuntimeEvent<DeliverableCreatedPayload>): NewDeliverable {
  const { payload } = event;
  const originalSize = byteLength(payload.content);
  let content = payload.content;
  if (originalSize > MAX_CONTENT_BYTES) {
    content = clampUtf8(payload.content, MAX_CONTENT_BYTES);
    // eslint-disable-next-line no-console
    console.warn(
      `[DeliverablePersistence] deliverable ${payload.deliverableId} content truncated from ${originalSize}B to ~${MAX_CONTENT_BYTES}B`,
    );
  }
  return {
    deliverable_id: payload.deliverableId,
    company_id: event.companyId,
    thread_id: payload.threadId ?? null,
    title: payload.title,
    content,
    kind: payload.kind ?? null,
    file_name: payload.fileName ?? null,
    mime_type: payload.mimeType ?? null,
    contributors_json: JSON.stringify(payload.contributingEmployees ?? []),
    created_at: new Date(payload.createdAt).toISOString(),
  };
}

export class DeliverablePersistenceService {
  private readonly eventBus: EventBus;
  private readonly repo?: DeliverableRepository;
  private unsubscribe: (() => void) | null = null;
  private warnedMissingRepo = false;

  constructor(options: DeliverablePersistenceServiceOptions) {
    this.eventBus = options.eventBus;
    this.repo = options.repo;
    this.unsubscribe = this.eventBus.on('deliverable.created', (event) => {
      void this.handle(event as RuntimeEvent<DeliverableCreatedPayload>);
    });
  }

  private async handle(event: RuntimeEvent<DeliverableCreatedPayload>): Promise<void> {
    if (!this.repo) {
      if (!this.warnedMissingRepo) {
        this.warnedMissingRepo = true;
        // eslint-disable-next-line no-console
        console.warn(
          '[DeliverablePersistence] repos.deliverables is missing — deliverable events will NOT be persisted this session',
        );
      }
      return;
    }
    try {
      await this.repo.insert(mapPayloadToRow(event));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[DeliverablePersistence] failed to insert deliverable ${event.payload.deliverableId}`,
        err,
      );
    }
  }

  dispose(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}
