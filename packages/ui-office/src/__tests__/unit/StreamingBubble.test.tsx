import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mockUseStreamingContent = vi.fn();

vi.mock('../../runtime/use-streaming-content.js', () => ({
  useStreamingContent: () => mockUseStreamingContent(),
}));

import { StreamingBubble } from '../../components/chat/StreamingBubble.js';

describe('StreamingBubble', () => {
  it('shows a meaningful placeholder before streamed text arrives', () => {
    mockUseStreamingContent.mockReturnValue({
      content: '',
      isStreaming: true,
      nodeName: 'boss',
    });

    render(<StreamingBubble />);

    expect(screen.getByText('Boss')).toBeInTheDocument();
    expect(screen.getByText('Drafting the response...')).toBeInTheDocument();
  });

  it('prefers streamed content once chunks arrive', () => {
    mockUseStreamingContent.mockReturnValue({
      content: 'Here is the answer so far',
      isStreaming: true,
      nodeName: 'employee',
    });

    render(<StreamingBubble />);

    expect(screen.getByText('Employee')).toBeInTheDocument();
    expect(screen.getByText('Here is the answer so far')).toBeInTheDocument();
    expect(screen.queryByText('Working through the request...')).toBeNull();
  });

  it('renders streamed callouts with the same readable block treatment as final replies', () => {
    mockUseStreamingContent.mockReturnValue({
      content: '> Result: Draft is ready for review.',
      isStreaming: true,
      nodeName: 'boss_summary',
    });

    render(<StreamingBubble />);

    expect(screen.getByText('Result')).toBeInTheDocument();
    expect(screen.getByText('Draft is ready for review.')).toBeInTheDocument();
  });
});
