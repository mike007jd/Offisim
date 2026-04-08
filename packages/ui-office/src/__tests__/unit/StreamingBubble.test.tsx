import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StreamingBubble } from '../../components/chat/StreamingBubble.js';

describe('StreamingBubble', () => {
  it('shows a meaningful placeholder before streamed text arrives', () => {
    render(<StreamingBubble content="" reasoning="" isStreaming={true} nodeName="boss" />);

    expect(screen.getByText('Boss')).toBeInTheDocument();
    expect(screen.getByText('Drafting the response...')).toBeInTheDocument();
  });

  it('prefers streamed content once chunks arrive', () => {
    render(
      <StreamingBubble
        content="Here is the answer so far"
        reasoning=""
        isStreaming={true}
        nodeName="employee"
      />,
    );

    expect(screen.getByText('Employee')).toBeInTheDocument();
    expect(screen.getByText('Here is the answer so far')).toBeInTheDocument();
    expect(screen.queryByText('Working through the request...')).toBeNull();
  });

  it('renders reasoning separately from visible draft content', () => {
    render(
      <StreamingBubble
        content="Visible answer"
        reasoning="Let me compare two approaches"
        isStreaming={true}
        nodeName="boss"
      />,
    );

    expect(screen.getByText('Reasoning')).toBeInTheDocument();
    expect(screen.getByText('Let me compare two approaches')).toBeInTheDocument();
    expect(screen.getByText('Visible answer')).toBeInTheDocument();
  });
});
