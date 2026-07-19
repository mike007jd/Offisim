import { cn } from '@/lib/utils.js';
import type { ComponentPropsWithRef, ElementType } from 'react';
import { createElement } from 'react';

type SelectableCardOwnProps<T extends ElementType> = {
  as?: T;
  selected?: boolean;
  selectedClassName?: string;
};

export type SelectableCardProps<T extends ElementType = 'button'> = SelectableCardOwnProps<T> &
  Omit<ComponentPropsWithRef<T>, keyof SelectableCardOwnProps<T>>;

/**
 * Renderer-local selectable card root. Callers retain ownership of the exact
 * element, classes, events and accessibility contract.
 */
export function SelectableCard<T extends ElementType = 'button'>({
  as,
  selected = false,
  selectedClassName,
  className,
  ...props
}: SelectableCardProps<T>) {
  const Component = (as ?? 'button') as ElementType;
  return createElement(Component, {
    ...props,
    className: cn(className, selected && selectedClassName),
  });
}
