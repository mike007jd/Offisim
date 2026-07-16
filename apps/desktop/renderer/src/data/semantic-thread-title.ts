import type { RuntimeRepositories } from '@offisim/core/browser';
import type {
  DesktopAgentRuntime,
  TurnExecutionProvenance,
} from '../runtime/desktop-agent-runtime.js';

const MAX_SEMANTIC_TITLE_CHARS = 40;
const MAX_USER_CONTEXT_CHARS = 2_000;
const MAX_ASSISTANT_CONTEXT_CHARS = 4_000;

export interface ClaimedSemanticTitleJob {
  threadId: string;
  jobId: string;
  sourceProvenance: TurnExecutionProvenance;
}

function clipContext(text: string, maxChars: number): string {
  const chars = [...text];
  return chars.length <= maxChars ? text : chars.slice(0, maxChars).join('');
}

export function normalizeSemanticThreadTitle(raw: string): string | null {
  let title = raw
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/[`*_~#]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  title = title
    .replace(/^(?:title|conversation title|标题|对话标题|主题)\s*[:：-]\s*/iu, '')
    .replace(/^(?:about|discussion(?: of)?|help(?:ing)? with|关于|讨论|帮助)\s*/iu, '')
    .replace(/^["'“”‘’「『（(]+|["'“”‘’」』）)]+$/gu, '')
    .trim();
  if (!title) return null;
  const chars = [...title];
  if (chars.length <= MAX_SEMANTIC_TITLE_CHARS) return title;
  return `${chars
    .slice(0, MAX_SEMANTIC_TITLE_CHARS - 1)
    .join('')
    .trimEnd()}…`;
}

export async function claimSemanticTitleJob(input: {
  repos: RuntimeRepositories;
  threadId: string;
  sourceProvenance: TurnExecutionProvenance;
}): Promise<ClaimedSemanticTitleJob | null> {
  const jobId = `semantic-title:${input.threadId}`;
  const claimed = await input.repos.chatThreads.beginSemanticTitleJob({
    threadId: input.threadId,
    jobId,
    sourceProvenanceJson: JSON.stringify(input.sourceProvenance),
  });
  return claimed
    ? {
        threadId: input.threadId,
        jobId,
        sourceProvenance: input.sourceProvenance,
      }
    : null;
}

export async function generateSemanticThreadTitle(input: {
  repos: RuntimeRepositories;
  runtime: DesktopAgentRuntime;
  job: ClaimedSemanticTitleJob;
  firstUserText: string;
  firstAssistantText: string;
}): Promise<string | null> {
  try {
    const result = await input.runtime.generateText({
      jobId: input.job.jobId,
      sourceProvenance: input.job.sourceProvenance,
      systemPrompt: [
        'Create one short, specific conversation title in the same language as the user.',
        'Capture the concrete task or decision, not the act of chatting.',
        'Never start with About, Discussion, Help, 关于, 讨论, or 帮助.',
        'Return only the title, with no label, quotes, markdown, or explanation.',
        'Keep it within 40 characters.',
      ].join(' '),
      text: `User:\n${clipContext(input.firstUserText, MAX_USER_CONTEXT_CHARS)}\n\nAssistant:\n${clipContext(input.firstAssistantText, MAX_ASSISTANT_CONTEXT_CHARS)}`,
    });
    const title = normalizeSemanticThreadTitle(result.text);
    if (!title) {
      await input.repos.chatThreads.failSemanticTitleJob({
        threadId: input.job.threadId,
        jobId: input.job.jobId,
        errorCode: 'invalid-output',
      });
      return null;
    }
    const persisted = await input.repos.chatThreads.completeSemanticTitleJob({
      threadId: input.job.threadId,
      jobId: input.job.jobId,
      title,
      resultProvenanceJson: JSON.stringify(result.provenance),
      usageJson: result.usage ? JSON.stringify(result.usage) : null,
    });
    return persisted ? title : null;
  } catch (error) {
    await input.repos.chatThreads.failSemanticTitleJob({
      threadId: input.job.threadId,
      jobId: input.job.jobId,
      errorCode: 'runtime-failed',
    });
    throw error;
  }
}
