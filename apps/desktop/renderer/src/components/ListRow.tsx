import { cn } from '@/lib/utils.js';
import type { ComponentPropsWithRef, ElementType } from 'react';
import { createElement } from 'react';

type RowElementOwnProps<T extends ElementType> = {
  as?: T;
};

type RowElementProps<T extends ElementType> = RowElementOwnProps<T> &
  Omit<ComponentPropsWithRef<T>, keyof RowElementOwnProps<T>>;

type ListRowOwnProps<T extends ElementType> = RowElementOwnProps<T> & {
  selected?: boolean;
  selectedClassName?: string;
};

export type ListRowProps<T extends ElementType = 'button'> = ListRowOwnProps<T> &
  Omit<ComponentPropsWithRef<T>, keyof ListRowOwnProps<T>>;

/**
 * Renderer-local list row root. Structural slots below preserve each surface's
 * existing DOM and visual classes while sharing the row vocabulary.
 */
export function ListRow<T extends ElementType = 'button'>({
  as,
  selected = false,
  selectedClassName,
  className,
  ...props
}: ListRowProps<T>) {
  const Component = (as ?? 'button') as ElementType;
  return createElement(Component, {
    ...props,
    className: cn(className, selected && selectedClassName),
  });
}

export function ListRowAvatar<T extends ElementType = 'span'>({
  as,
  ...props
}: RowElementProps<T>) {
  const Component = (as ?? 'span') as ElementType;
  return createElement(Component, props);
}

export function ListRowTitle<T extends ElementType = 'span'>({ as, ...props }: RowElementProps<T>) {
  const Component = (as ?? 'span') as ElementType;
  return createElement(Component, props);
}

export function ListRowSubtitle<T extends ElementType = 'span'>({
  as,
  ...props
}: RowElementProps<T>) {
  const Component = (as ?? 'span') as ElementType;
  return createElement(Component, props);
}

export function ListRowMeta<T extends ElementType = 'span'>({ as, ...props }: RowElementProps<T>) {
  const Component = (as ?? 'span') as ElementType;
  return createElement(Component, props);
}
