import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    const markdownReply = [
      '**Plan**',
      '',
      '- First step',
      '- `Second` step',
      '',
      '```ts',
      'const value = 1;',
      '```',
    ].join('\n');

    render(createElement(MessageBubble, { role: 'assistant', content: markdownReply }));

    expect(screen.getByText('Plan')).toBeInTheDocument();
    expect(screen.getByText('First step')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
    expect(screen.getByText('ts')).toBeInTheDocument();
    expect(screen.getByText('const value = 1;')).toBeInTheDocument();
  });

  it('keeps agent badges while rendering the assistant body separately', () => {
    render(
      createElement(MessageBubble, {
        role: 'assistant',
        content: '[Alice]: **Reviewed** the output.',
      }),
    );

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Reviewed')).toBeInTheDocument();
    expect(screen.getByText('the output.')).toBeInTheDocument();
  });

  it('collapses long assistant replies until the reader expands them', async () => {
    const user = userEvent.setup();
    const longReply = Array.from({ length: 9 }, (_, index) => `Paragraph ${index + 1}`).join(
      '\n\n',
    );

    render(createElement(MessageBubble, { role: 'assistant', content: longReply }));

    expect(screen.getByRole('button', { name: 'Show full response' })).toBeInTheDocument();
    expect(screen.queryByText('Paragraph 9')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Show full response' }));

    expect(screen.getByRole('button', { name: 'Collapse response' })).toBeInTheDocument();
    expect(screen.getByText('Paragraph 9')).toBeInTheDocument();
  });

  it('adds a copy action for fenced code blocks', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    render(
      createElement(MessageBubble, {
        role: 'assistant',
        content: ['```ts', 'const answer = 42;', '```'].join('\n'),
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Copy code block' }));

    expect(writeText).toHaveBeenCalledWith('const answer = 42;');
  });

  it('renders prefixed note and warning lines as readable callout blocks', () => {
    render(
      createElement(MessageBubble, {
        role: 'assistant',
        content: [
          '> Note: Shared context helps the whole team.',
          '> Warning: This will overwrite the draft.',
        ].join('\n\n'),
      }),
    );

    expect(screen.getByText('Note')).toBeInTheDocument();
    expect(screen.getByText('Shared context helps the whole team.')).toBeInTheDocument();
    expect(screen.getByText('Warning')).toBeInTheDocument();
    expect(screen.getByText('This will overwrite the draft.')).toBeInTheDocument();
  });
});
