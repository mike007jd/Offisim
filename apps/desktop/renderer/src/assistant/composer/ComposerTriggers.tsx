import type { Employee } from '@/data/types.js';
import { Icon } from '@/design-system/icons/Icon.js';
import {
  ComposerPrimitive,
  unstable_useMentionAdapter,
  unstable_useSlashCommandAdapter,
} from '@assistant-ui/react';
import {
  Activity,
  Brain,
  Globe,
  Inbox,
  MessageSquarePlus,
  MonitorSmartphone,
  Package,
  Repeat,
  Settings,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { useMemo } from 'react';
import {
  type MentionEmployee,
  buildSlashCommands,
  employeeMentionItems,
  makeEmployeeDirectiveFormatter,
  toMentionRoster,
} from './composer-triggers.js';

function slashIcon(id: string) {
  switch (id) {
    case 'new':
      return MessageSquarePlus;
    case 'loop':
      return Repeat;
    case 'skill':
      return Sparkles;
    case 'tool':
      return Wrench;
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
 */
export function ComposerTriggers({ employees }: { employees: readonly Employee[] }) {
  const roster: MentionEmployee[] = useMemo(() => toMentionRoster(employees), [employees]);
  const formatter = useMemo(() => makeEmployeeDirectiveFormatter(roster), [roster]);
  const mentionItems = useMemo(() => employeeMentionItems(roster), [roster]);
  const mention = unstable_useMentionAdapter({
    items: mentionItems,
    includeModelContextTools: false,
    formatter,
  });

  const slashCommands = useMemo(() => buildSlashCommands(), []);
  const slash = unstable_useSlashCommandAdapter({ commands: slashCommands, removeOnExecute: true });

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
          {(items) =>
            items.map((item) => (
              <ComposerPrimitive.Unstable_TriggerPopoverItem
                key={item.id}
                item={item}
                className="off-trigger-item off-focusable"
              >
                <span className="off-trigger-glyph">
                  <Icon icon={slashIcon(item.id)} size="sm" />
                </span>
                <span className="off-trigger-row">
                  <span className="off-trigger-name">/{item.id}</span>
                  {item.description ? (
                    <span className="off-trigger-meta">{item.description}</span>
                  ) : null}
                </span>
              </ComposerPrimitive.Unstable_TriggerPopoverItem>
            ))
          }
        </ComposerPrimitive.Unstable_TriggerPopoverItems>
      </ComposerPrimitive.Unstable_TriggerPopover>
    </>
  );
}
