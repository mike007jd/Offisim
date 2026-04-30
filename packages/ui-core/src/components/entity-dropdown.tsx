import type { ReactNode } from 'react';
import { cn } from '../lib/utils.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu.js';

export interface EntityDropdownItem {
  id: string;
  label: ReactNode;
  /** Optional icon node rendered before the label. */
  icon?: ReactNode;
  /** Optional badge node rendered after the label (e.g., "Active"). */
  badge?: ReactNode;
  /** Optional secondary line rendered below the label. */
  hint?: ReactNode;
  disabled?: boolean;
}

export interface EntityDropdownSection {
  /** Optional uppercase title rendered above the section's items. */
  title?: ReactNode;
  items: ReadonlyArray<EntityDropdownItem>;
}

export interface EntityDropdownFooterAction {
  label: ReactNode;
  onSelect: () => void;
  /** Show a 1px divider above the footer. Defaults to true. */
  divider?: boolean;
  /** Optional icon rendered before the label. */
  icon?: ReactNode;
}

interface EntityDropdownBaseProps {
  /** Trigger element rendered as the dropdown anchor. */
  trigger: ReactNode;
  align?: 'start' | 'center' | 'end';
  collisionPadding?: number;
  contentClassName?: string;
  /** Optional uppercase title shown above the body. */
  title?: ReactNode;
  /** Optional footer action rendered below an optional divider. */
  footerAction?: EntityDropdownFooterAction;
  /** Controlled open state (Radix). */
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
}

interface EntityDropdownItemsModeProps extends EntityDropdownBaseProps {
  items: ReadonlyArray<EntityDropdownItem>;
  activeId: string | null;
  onSelect: (id: string) => void;
  emptyText?: ReactNode;
  /** Custom content rendered after the items list, before the footer. */
  bodyExtras?: ReactNode;
  sections?: never;
  children?: never;
}

interface EntityDropdownSectionsModeProps extends EntityDropdownBaseProps {
  sections: ReadonlyArray<EntityDropdownSection>;
  activeId: string | null;
  onSelect: (id: string) => void;
  emptyText?: ReactNode;
  /** Custom content rendered after the sections, before the footer. */
  bodyExtras?: ReactNode;
  items?: never;
  children?: never;
}

interface EntityDropdownCustomModeProps extends EntityDropdownBaseProps {
  /** Arbitrary content rendered between optional title and optional footer. */
  children: ReactNode;
  items?: never;
  sections?: never;
  activeId?: never;
  onSelect?: never;
  emptyText?: never;
}

export type EntityDropdownProps =
  | EntityDropdownItemsModeProps
  | EntityDropdownSectionsModeProps
  | EntityDropdownCustomModeProps;

/**
 * Recurring "trigger row + scrollable item list + footer action" dropdown shape.
 * Built atop the DropdownMenu primitive so it inherits portal, focus, and modal-stack semantics.
 *
 * Three modes:
 * - Flat `items` + `activeId` + `onSelect`
 * - Grouped `sections` (each with optional title)
 * - Custom `children` body (thin wrapper that still inherits the trigger / portal / footer shell)
 */
export function EntityDropdown(props: EntityDropdownProps) {
  const {
    trigger,
    align = 'start',
    collisionPadding,
    contentClassName,
    title,
    footerAction,
    open,
    onOpenChange,
  } = props;
  const showDivider = footerAction?.divider !== false;

  let body: ReactNode;
  if ('children' in props && props.children !== undefined) {
    body = props.children;
  } else if ('sections' in props && props.sections !== undefined) {
    const totalItems = props.sections.reduce((sum, s) => sum + s.items.length, 0);
    const sectionsBody =
      totalItems === 0
        ? props.emptyText
          ? (
              <div className="px-2 py-3 text-xs text-text-muted">{props.emptyText}</div>
            )
          : null
        : props.sections.map((section, idx) => (
            <SectionGroup
              key={`${idx}:${typeof section.title === 'string' ? section.title : 'untitled'}`}
              section={section}
              activeId={props.activeId}
              onSelect={props.onSelect}
            />
          ));
    body = (
      <>
        {sectionsBody}
        {props.bodyExtras}
      </>
    );
  } else if ('items' in props && props.items !== undefined) {
    const itemsBody =
      props.items.length === 0
        ? props.emptyText
          ? (
              <div className="px-2 py-3 text-xs text-text-muted">{props.emptyText}</div>
            )
          : null
        : props.items.map((item) => (
            <Row
              key={item.id}
              item={item}
              isActive={item.id === props.activeId}
              onSelect={() => props.onSelect(item.id)}
            />
          ));
    body = (
      <>
        {itemsBody}
        {props.bodyExtras}
      </>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        collisionPadding={collisionPadding}
        className={cn('p-1', contentClassName)}
      >
        {title ? (
          <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
            {title}
          </div>
        ) : null}
        {body}
        {footerAction ? (
          <>
            {showDivider ? <div className="my-1 h-px bg-border-subtle" /> : null}
            <DropdownMenuItem
              onSelect={footerAction.onSelect}
              className="font-medium"
            >
              {footerAction.icon ? <span className="shrink-0">{footerAction.icon}</span> : null}
              <span>{footerAction.label}</span>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SectionGroup({
  section,
  activeId,
  onSelect,
}: {
  section: EntityDropdownSection;
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      {section.title ? (
        <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
          {section.title}
        </div>
      ) : null}
      {section.items.map((item) => (
        <Row
          key={item.id}
          item={item}
          isActive={item.id === activeId}
          onSelect={() => onSelect(item.id)}
        />
      ))}
    </>
  );
}

function Row({
  item,
  isActive,
  onSelect,
}: {
  item: EntityDropdownItem;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      disabled={item.disabled}
      className="flex items-start gap-2"
    >
      {item.icon ? <span className="mt-0.5 shrink-0">{item.icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{item.label}</span>
        {item.hint ? (
          <span className="mt-0.5 block truncate text-[10px] text-text-muted">{item.hint}</span>
        ) : null}
      </span>
      {item.badge ? <span className="ml-auto shrink-0">{item.badge}</span> : null}
      {!item.badge && isActive ? (
        <span className="ml-auto rounded-full bg-success-muted px-1.5 py-0.5 text-[10px] text-success">
          Active
        </span>
      ) : null}
    </DropdownMenuItem>
  );
}
