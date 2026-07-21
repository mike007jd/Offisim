import { useEmployeeMcpTools, useEmployeeSkills } from '@/data/queries.js';
import type { Employee } from '@/data/types.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { usePiThreadModeStore } from '@/runtime/pi-thread-mode-store.js';
import {
  ComposerPrimitive,
  unstable_useMentionAdapter,
  unstable_useSlashCommandAdapter,
  useComposerRuntime,
} from '@assistant-ui/react';
import {
  Activity,
  Brain,
  Eye,
  Globe,
  Inbox,
  MessageCircleQuestion,
  MessageSquarePlus,
  MonitorSmartphone,
  Package,
  Puzzle,
  Repeat,
  Settings,
  ShieldCheck,
  Sparkles,
  Wrench,
  Zap,
} from 'lucide-react';
import { Fragment, useMemo } from 'react';
import {
  type MentionEmployee,
  type OfficeSlashCommand,
  SLASH_CATEGORY_LABEL,
  type SlashCategory,
  buildSlashCommands,
  employeeMentionItems,
  makeEmployeeDirectiveFormatter,
  toMentionRoster,
} from './composer-triggers.js';

function slashIcon(id: string) {
  if (id.startsWith('skill:')) return Sparkles;
  if (id.startsWith('tool:')) return Wrench;
  switch (id) {
    case 'new':
      return MessageSquarePlus;
    case 'loop':
      return Repeat;
    case 'skill':
      return Puzzle;
    case 'tool':
      return Wrench;
    case 'plan':
      return Eye;
    case 'ask':
      return MessageCircleQuestion;
    case 'auto':
      return ShieldCheck;
    case 'full':
      return Zap;
    case 'browser':
      return Globe;
    case 'computer':
      return MonitorSmartphone;
    case 'memory':
      return Brain;
    case 'output':
      return Package;
    case 'inbox':
      return Inbox;
    case 'activity':
      return Activity;
    case 'settings':
      return Settings;
    default:
      return MessageSquarePlus;
  }
}

/**
 * In-composer `@` (mention a teammate) and `/` (run a command) trigger popovers.
 * assistant-ui owns char detection, filtering, keyboard nav, and positioning of
 * the listbox; we supply the data, the clean `@Name` serialization, and the
 * command actions. Must render inside `ComposerPrimitive.Unstable_TriggerPopoverRoot`.
 *
 * The `/` palette is grouped — Commands / Skills / Tools & MCP / Modes /
 * Navigation — via quiet headers between category runs; filtering still works
 * across the whole list. `/skill` and `/tool` expand the employee's currently
 * available items and insert executable directives into the composer.
 */
export function ComposerTriggers({
  employees,
  threadId,
  employeeId,
}: {
  employees: readonly Employee[];
  threadId: string;
  /** The thread's acting employee; skills/tools expand for them. */
  employeeId: string | null;
}) {
  const roster: MentionEmployee[] = useMemo(() => toMentionRoster(employees), [employees]);
  const formatter = useMemo(() => makeEmployeeDirectiveFormatter(roster), [roster]);
  const mentionItems = useMemo(() => employeeMentionItems(roster), [roster]);
  const mention = unstable_useMentionAdapter({
    items: mentionItems,
    includeModelContextTools: false,
    formatter,
  });

  const composer = useComposerRuntime();
  const skills = useEmployeeSkills(employeeId);
  const mcpTools = useEmployeeMcpTools(employeeId);
  const setThreadMode = usePiThreadModeStore((s) => s.setThreadMode);

  const slashCommands = useMemo(
    () =>
      buildSlashCommands({
        skills: (skills.data ?? []).map((skill) => ({
          id: skill.id,
          name: skill.name,
          ...(skill.description ? { description: skill.description } : {}),
        })),
        tools: (mcpTools.data ?? []).map((tool) => ({
          id: tool.id,
          serverName: tool.serverName,
          toolName: tool.toolName,
          title: tool.title,
          ...(tool.description ? { description: tool.description } : {}),
        })),
        insertText: (text) => {
          const current = composer.getState().text;
          composer.setText(current ? `${current.replace(/\s+$/u, '')} ${text}` : text);
        },
        setMode: (mode) => setThreadMode(threadId, mode),
      }),
    [skills.data, mcpTools.data, composer, setThreadMode, threadId],
  );
  const categoryByCommandId = useMemo(
    () => new Map(slashCommands.map((command) => [command.id, command.category] as const)),
    [slashCommands],
  );
  const slash = unstable_useSlashCommandAdapter({
    commands: slashCommands satisfies OfficeSlashCommand[],
    removeOnExecute: true,
  });

  return (
    <>
      <ComposerPrimitive.Unstable_TriggerPopover
        char="@"
        adapter={mention.adapter}
        className="off-trigger-pop"
      >
        <ComposerPrimitive.Unstable_TriggerPopover.Directive {...mention.directive} />
        <ComposerPrimitive.Unstable_TriggerPopoverItems className="off-trigger-list">
          {(items) =>
            items.length ? (
              items.map((item) => (
                <ComposerPrimitive.Unstable_TriggerPopoverItem
                  key={item.id}
                  item={item}
                  className="off-trigger-item off-focusable"
                >
                  <span className="off-trigger-row">
                    <span className="off-trigger-name">{item.label}</span>
                    {item.description ? (
                      <span className="off-trigger-meta">{item.description}</span>
                    ) : null}
                  </span>
                </ComposerPrimitive.Unstable_TriggerPopoverItem>
              ))
            ) : (
              <div className="off-trigger-empty">No teammates to mention</div>
            )
          }
        </ComposerPrimitive.Unstable_TriggerPopoverItems>
      </ComposerPrimitive.Unstable_TriggerPopover>

      <ComposerPrimitive.Unstable_TriggerPopover
        char="/"
        adapter={slash.adapter}
        className="off-trigger-pop"
      >
        <ComposerPrimitive.Unstable_TriggerPopover.Action {...slash.action} />
        <ComposerPrimitive.Unstable_TriggerPopoverItems className="off-trigger-list">
          {(items) => {
            let lastCategory: SlashCategory | null = null;
            return items.map((item) => {
              const category = categoryByCommandId.get(item.id) ?? 'commands';
              const showHeader = category !== lastCategory;
              lastCategory = category;
              return (
                <Fragment key={item.id}>
                  {showHeader ? (
                    <div className="off-trigger-group" aria-hidden>
                      {SLASH_CATEGORY_LABEL[category]}
                    </div>
                  ) : null}
                  <ComposerPrimitive.Unstable_TriggerPopoverItem
                    item={item}
                    className="off-trigger-item off-focusable"
                  >
                    <span className="off-trigger-glyph">
                      <Icon icon={slashIcon(item.id)} size="sm" />
                    </span>
                    <span className="off-trigger-row">
                      <span className="off-trigger-name">{item.label}</span>
                      {item.description ? (
                        <span className="off-trigger-meta">{item.description}</span>
                      ) : null}
                    </span>
                  </ComposerPrimitive.Unstable_TriggerPopoverItem>
                </Fragment>
              );
            });
          }}
        </ComposerPrimitive.Unstable_TriggerPopoverItems>
      </ComposerPrimitive.Unstable_TriggerPopover>
    </>
  );
}
