import { describe, expect, it } from 'vitest';
import React from 'react';
import { WorkspacePageShell } from './WorkspacePageShell';

// ---------------------------------------------------------------------------
// WorkspacePageShell — structural unit tests
// ---------------------------------------------------------------------------
// These tests verify the component returns the correct React element tree
// for each state (normal, loading, error, empty) by inspecting the shallow
// element structure returned by the component function.
// ---------------------------------------------------------------------------

function getProps(element: React.ReactElement): Record<string, unknown> {
  return element.props as Record<string, unknown>;
}

/**
 * Recursively search for a data-testid in the React element tree.
 * Handles both plain elements and function component elements by
 * calling function components to get their rendered output.
 */
function findByTestId(
  element: React.ReactElement,
  testId: string,
): React.ReactElement | null {
  const props = getProps(element);

  // Check current element
  if (props['data-testid'] === testId) return element;

  // If this is a function component, call it to get rendered output
  if (typeof element.type === 'function') {
    try {
      const rendered = (element.type as (p: unknown) => React.ReactElement)(props);
      if (React.isValidElement(rendered)) {
        const found = findByTestId(rendered, testId);
        if (found) return found;
      }
    } catch {
      // Skip if component can't be called directly
    }
  }

  // Traverse children
  const children = React.Children.toArray(props.children as React.ReactNode);
  for (const child of children) {
    if (React.isValidElement(child)) {
      const found = findByTestId(child, testId);
      if (found) return found;
    }
  }
  return null;
}

describe('WorkspacePageShell', () => {
  it('renders with data-testid workspace-page-shell', () => {
    const el = WorkspacePageShell({
      eyebrow: 'Workspace',
      title: 'SOPs',
      children: React.createElement('div', null, 'content'),
    });
    expect(getProps(el)['data-testid']).toBe('workspace-page-shell');
  });

  it('renders loading skeleton when loading is true', () => {
    const el = WorkspacePageShell({
      eyebrow: 'Workspace',
      title: 'SOPs',
      loading: true,
      children: React.createElement('div', null, 'content'),
    });
    const skeleton = findByTestId(el, 'workspace-loading-skeleton');
    expect(skeleton).not.toBeNull();
  });

  it('renders error state when error is provided', () => {
    const el = WorkspacePageShell({
      eyebrow: 'Workspace',
      title: 'SOPs',
      error: 'Something went wrong',
      children: React.createElement('div', null, 'content'),
    });
    const errorEl = findByTestId(el, 'workspace-error');
    expect(errorEl).not.toBeNull();
  });

  it('renders empty state when empty prop is provided', () => {
    const emptyNode = React.createElement('div', { 'data-testid': 'custom-empty' }, 'No data');
    const el = WorkspacePageShell({
      eyebrow: 'Workspace',
      title: 'SOPs',
      empty: emptyNode,
      children: React.createElement('div', null, 'content'),
    });
    const emptyEl = findByTestId(el, 'workspace-empty');
    expect(emptyEl).not.toBeNull();
  });

  it('renders children in content area when no special state', () => {
    const el = WorkspacePageShell({
      eyebrow: 'Workspace',
      title: 'SOPs',
      children: React.createElement('div', { 'data-testid': 'child-content' }, 'content'),
    });
    // Should not have loading, error, or empty states
    expect(findByTestId(el, 'workspace-loading-skeleton')).toBeNull();
    expect(findByTestId(el, 'workspace-error')).toBeNull();
    expect(findByTestId(el, 'workspace-empty')).toBeNull();
    // Should have the shell
    expect(getProps(el)['data-testid']).toBe('workspace-page-shell');
  });

  it('loading takes precedence over error', () => {
    const el = WorkspacePageShell({
      eyebrow: 'Workspace',
      title: 'SOPs',
      loading: true,
      error: 'Something went wrong',
      children: React.createElement('div', null, 'content'),
    });
    expect(findByTestId(el, 'workspace-loading-skeleton')).not.toBeNull();
    expect(findByTestId(el, 'workspace-error')).toBeNull();
  });
});
