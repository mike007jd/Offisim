import type { InteractionRequest, InteractionResponse } from '@offisim/shared-types';
import type { EventBus } from '../events/event-bus.js';
import { errorOccurred } from '../events/event-factories.js';
import type {
  SkillInstallConfirmHandler,
  SkillInstallConfirmOutcome,
} from '../services/interaction-service.js';
import { Logger } from '../services/logger.js';
import type { SkillLoader } from './skill-loader.js';
import type { SkillStagingManager, StagedSkill, StagedSkillInstall } from './skill-staging.js';

const logger = new Logger('skill-install-committer');

export interface SkillInstallCommitterDeps {
  companyId: string;
  threadId: string;
  skillLoader: SkillLoader;
  staging: SkillStagingManager;
  eventBus?: EventBus;
}

/**
 * Commits or cancels a staged skill install when its `skill_install_confirm`
 * interaction resolves. Wired into `InteractionService` via the optional
 * `skillInstallConfirmHandler` dep. Errors are surfaced to the thread via
 * the shared `error.occurred` event rather than thrown — the interaction
 * itself is already considered resolved once the user clicked through.
 */
export class SkillInstallCommitter implements SkillInstallConfirmHandler {
  constructor(private readonly deps: SkillInstallCommitterDeps) {}

  async handle(
    request: InteractionRequest,
    response: InteractionResponse,
  ): Promise<SkillInstallConfirmOutcome> {
    const context = request.context;
    if (context?.type !== 'skill_install_confirm') {
      return { kind: 'cancelled' };
    }
    const { staging } = this.deps;

    if (response.selectedOptionId !== 'confirm') {
      await staging.release(context.stagingRef);
      return { kind: 'cancelled' };
    }

    const staged = await staging.take(context.stagingRef);
    if (!staged) {
      return { kind: 'staging-expired' };
    }

    try {
      if (staged.action === 'edit') {
        return await this.commitEdit(staged);
      }
      return await this.commitInstallOrFork(staged);
    } catch (err) {
      logger.warn('skill mutation failed after user confirm', {
        stagingRef: context.stagingRef,
        action: staged.action,
        error: err instanceof Error ? err.message : String(err),
      });
      const maybeKind = (err as { kind?: unknown } | null)?.kind;
      const errorKind =
        typeof maybeKind === 'string' && maybeKind
          ? maybeKind
          : staged.action === 'edit'
            ? 'edit-failed'
            : 'install-failed';
      this.deps.eventBus?.emit(
        errorOccurred(
          this.deps.companyId,
          errorKind,
          err instanceof Error ? err.message : String(err),
          false,
          'skill-install-committer',
          { threadId: this.deps.threadId },
        ),
      );
      return {
        kind: 'error',
        errorKind,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async commitInstallOrFork(
    staged: StagedSkillInstall,
  ): Promise<SkillInstallConfirmOutcome> {
    const { skillLoader } = this.deps;
    const assets: { relPath: string; content: Uint8Array | string }[] = [];
    const rootPrefix = staged.scan.root.length > 0 ? `${staged.scan.root}/` : '';
    for (const file of staged.tree.files) {
      if (file.path === staged.scan.skillMdPath) continue;
      const rel = rootPrefix.length > 0 ? file.path.slice(rootPrefix.length) : file.path;
      if (staged.scan.assetPaths.includes(rel)) {
        assets.push({ relPath: rel, content: file.content });
      }
    }
    const { row, wasExisting } = await skillLoader.installSkill({
      scope: staged.scope,
      companyId: staged.companyId,
      ...(staged.employeeId ? { employeeId: staged.employeeId } : {}),
      name: staged.name,
      description: staged.description,
      source: staged.source,
      files: {
        skillMd: staged.skillMdText,
        assets,
      },
    });
    if (staged.cleanup) {
      try {
        await staged.cleanup();
      } catch {
        /* best-effort */
      }
    }
    return { kind: 'installed', skillId: row.skill_id, wasExisting };
  }

  private async commitEdit(
    staged: Extract<StagedSkill, { action: 'edit' }>,
  ): Promise<SkillInstallConfirmOutcome> {
    const { row } = await this.deps.skillLoader.editSkillBody({
      skillId: staged.skillId,
      newBody: staged.newBody,
    });
    if (staged.cleanup) {
      try {
        await staged.cleanup();
      } catch {
        /* best-effort */
      }
    }
    return { kind: 'edited', skillId: row.skill_id };
  }
}
