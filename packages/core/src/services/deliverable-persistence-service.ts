import type { DeliverableCreatedPayload, RuntimeEvent } from '@offisim/shared-types';
import type { EventBus } from '../events/event-bus.js';
import type { DeliverableRepository, NewDeliverable } from '../runtime/repositories.js';
import { byteLength, clampUtf8 } from '../utils/byte-length.js';

const MAX_CONTENT_BYTES = 1_048_576; // 1 MB

export interface DeliverablePersistenceServiceOptions {
  readonly eventBus: EventBus;
  readonly repo?: DeliverableRepository;
}

export function mapPayloadToRow(event: RuntimeEvent<DeliverableCreatedPayload>): NewDeliverable {
  const { payload } = event;
  const originalSize = byteLength(payload.content);
  const content =
    originalSize > MAX_CONTENT_BYTES
      ? clampUtf8(payload.content, MAX_CONTENT_BYTES)
      : payload.content;
  if (originalSize > MAX_CONTENT_BYTES) {
    console.warn(
      `[DeliverablePersistence] deliverable ${payload.deliverableId} content truncated from ${originalSize}B to ~${MAX_CONTENT_BYTES}B`,
    );
  }
  return {
    deliverable_id: payload.deliverableId,
    company_id: event.companyId,
    thread_id: payload.threadId ?? null,
    chat_thread_id: payload.chatThreadId ?? null,
    title: payload.title,
    content,
    kind: payload.kind ?? null,
    file_name: payload.fileName ?? null,
    mime_type: payload.mimeType ?? null,
    contributors_json: JSON.stringify(payload.contributingEmployees ?? []),
    created_at: new Date(payload.createdAt).toISOString(),
    // Artifact provenance (VM-002): this legacy event-driven producer carries no
    // run/hash provenance, so default to none + version 1. The first-party
    // `publish_artifact` path stamps these for real.
    run_id: null,
    content_hash: null,
    version: 1,
  };
}

export class DeliverablePersistenceService {
  private readonly unsubscribe: () => void;
  private warnedMissingRepo = false;

  constructor(private readonly options: DeliverablePersistenceServiceOptions) {
    this.unsubscribe = options.eventBus.on('deliverable.created', (event) => {
      void this.handle(event as RuntimeEvent<DeliverableCreatedPayload>);
    });
  }

  private async handle(event: RuntimeEvent<DeliverableCreatedPayload>): Promise<void> {
    const repo = this.options.repo;
    if (!repo) {
      if (!this.warnedMissingRepo) {
        this.warnedMissingRepo = true;
        console.warn(
          '[DeliverablePersistence] repos.deliverables is missing — deliverable events will NOT be persisted this session',
        );
      }
      return;
    }
    try {
      await repo.insert(mapPayloadToRow(event));
    } catch (err) {
      console.error(
        `[DeliverablePersistence] failed to insert deliverable ${event.payload.deliverableId}`,
        err,
      );
    }
  }

  dispose(): void {
    this.unsubscribe();
  }
}
