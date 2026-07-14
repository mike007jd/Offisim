import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  MessageWorkspaceDisclosure,
  RunActivitySummary,
  WorkspaceDisclosure,
} from '../src/assistant/parts/WorkspaceDisclosure.js';

// `tsx` executes this out-of-tree harness with the classic JSX transform even
// though the renderer build uses the automatic runtime.
void React;

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

/**
 * React-markup oracle for the production display components shared by the two
 * workspace provenance surfaces. Source assertions pin their parent wiring so
 * the pure SSR checks cannot pass after RunActivityStrip or MessageItem drops
 * the component.
 */
export function runWorkspaceDisclosureMarkupOracle(): Record<string, unknown> {
  const provenance = {
    availability: 'bound' as const,
    source: 'known_root_recovery' as const,
    reasonCode: 'renamed_same_filesystem_object' as const,
    displayPath: '/Users/alex/Work/renamed-client-project/game',
  };
  const disclosure =
    'Selected Project folder: /Users/alex/Work/renamed-client-project/game — the Project folder moved or was renamed, and its filesystem identity still matches. File access is available for this Turn.';
  const latestSummary = `Workspace · ${disclosure}`;
  const runActivitySource = readFileSync(
    new URL('../src/assistant/parts/RunActivityStrip.tsx', import.meta.url),
    'utf8',
  );
  const messageItemSource = readFileSync(
    new URL('../src/surfaces/office/rail/MessageItem.tsx', import.meta.url),
    'utf8',
  );
  assert.ok(
    runActivitySource.includes('<RunActivitySummary summary={latestSummary} />'),
    'RunActivityStrip must render the tested collapsed summary component',
  );
  assert.ok(
    runActivitySource.includes('provenance={entry.workspaceProvenance}'),
    'RunActivityStrip must route full Workspace detail through the tested expanded component',
  );
  assert.ok(
    messageItemSource.includes('<MessageWorkspaceDisclosure message={message} />'),
    'MessageItem must render the tested persisted-message disclosure component',
  );
  const liveMarkup = renderToStaticMarkup(<RunActivitySummary summary={latestSummary} />);

  assert.ok(
    liveMarkup.includes(`title="${latestSummary}"`),
    'collapsed live activity must expose the complete Workspace summary in its title',
  );
  assert.equal(
    countOccurrences(liveMarkup, latestSummary),
    2,
    'collapsed live activity must use the same complete summary for visible text and title',
  );

  const expandedMarkup = renderToStaticMarkup(
    <WorkspaceDisclosure provenance={provenance} status="done" />,
  );
  assert.ok(expandedMarkup.includes('data-workspace-disclosure="true"'));
  assert.ok(expandedMarkup.includes('/Users/alex/Work/renamed-client-project/game'));
  assert.ok(expandedMarkup.includes('filesystem identity still matches'));
  assert.ok(expandedMarkup.includes('user-select:text'));
  assert.ok(expandedMarkup.includes('max-height:none'));
  assert.ok(expandedMarkup.includes('overflow:visible'));
  assert.equal(
    countOccurrences(expandedMarkup, disclosure),
    2,
    'expanded disclosure must retain the complete detail in both title and selectable content',
  );

  const persistedMarkup = renderToStaticMarkup(
    <MessageWorkspaceDisclosure message={{ workspaceProvenance: provenance }} />,
  );
  assert.ok(
    persistedMarkup.includes('data-workspace-disclosure="true"'),
    'persisted-message disclosure must render the full workspace component',
  );
  assert.ok(persistedMarkup.includes('/Users/alex/Work/renamed-client-project/game'));
  assert.ok(persistedMarkup.includes('filesystem identity still matches'));
  assert.equal(
    countOccurrences(persistedMarkup, disclosure),
    2,
    'reloaded MessageItem disclosure must retain the complete title and selectable content',
  );

  return {
    collapsedTitle: latestSummary,
    expandedSelectable: expandedMarkup.includes('user-select:text'),
    parentWiring: true,
    persistedMessageDisclosureCount: countOccurrences(persistedMarkup, disclosure),
  };
}
