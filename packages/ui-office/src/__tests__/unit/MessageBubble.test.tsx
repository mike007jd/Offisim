import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@offisim/ui-core', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('../../lib/agent-display.js', () => ({
  getBadgeColorForDisplayName: () => 'bg-slate-700 text-white',
}));

import { MessageBubble } from '../../components/chat/MessageBubble.js';

describe('MessageBubble', () => {
  it('renders assistant markdown-like paragraphs, bullets, and fenced code blocks consistently', () => {
    const markdownReply = ['**Plan**', '', '- First step', '- `Second` step', '', '```ts', 'const value = 1;', '```'].join(
      '\n',
    );

    render(createElement(MessageBubble, { role: 'assistant', content: markdownReply }));

    expect(screen.getByText('Plan')).toBeTruthy();
    expect(screen.getByText('First step')).toBeTruthy();
    expect(screen.getByText('Second')).toBeTruthy();
    expect(screen.getByText('ts')).toBeTruthy();
    expect(screen.getByText('const value = 1;')).toBeTruthy();
  });

  it('keeps agent badges while rendering the assistant body separately', () => {
    render(
      createElement(MessageBubble, {
        role: 'assistant',
        content: '[Alice]: **Reviewed** the output.',
      }),
    );

    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('Reviewed')).toBeTruthy();
    expect(screen.getByText('the output.')).toBeTruthy();
  });
});
