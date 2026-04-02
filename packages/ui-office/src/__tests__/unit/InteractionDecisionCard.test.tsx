import type { InteractionRequest } from '@offisim/shared-types';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { InteractionDecisionCard } from '../../components/chat/InteractionDecisionCard';

function makeRequest(overrides?: Partial<InteractionRequest>): InteractionRequest {
  return {
    interactionId: 'ix-1',
    threadId: 'thread-1',
    companyId: 'company-1',
    kind: 'permission_request',
    severity: 'normal',
    title: 'Approve tool access',
    prompt: 'Allow github/create_pr for this run?',
    options: [
      { id: 'approve_once', label: 'Approve once', scope: 'once' },
      { id: 'approve_thread', label: 'Approve for thread', scope: 'thread' },
      { id: 'reject', label: 'Reject' },
    ],
    recommendation: {
      optionId: 'approve_once',
      reason: 'First use of github/create_pr in this thread.',
    },
    allowFreeformResponse: true,
    placeholder: 'Tell Offisim what to do instead',
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('InteractionDecisionCard', () => {
  it('renders recommendation and forwards freeform responses', async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn();

    render(<InteractionDecisionCard request={makeRequest()} onRespond={onRespond} />);

    expect(screen.getByText('Boss recommends: Approve once')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('Tell Offisim what to do instead'), 'Read-only.');
    await user.click(screen.getByRole('button', { name: 'Approve once' }));

    expect(onRespond).toHaveBeenCalledWith('approve_once', 'Read-only.');
  });

  it('shows the originating employee name when provided', () => {
    render(
      <InteractionDecisionCard request={makeRequest()} employeeName="Ava" onRespond={vi.fn()} />,
    );

    expect(screen.getByText('From: Ava')).toBeInTheDocument();
  });

  it('does not render attribution when no employee name is provided', () => {
    render(<InteractionDecisionCard request={makeRequest()} onRespond={vi.fn()} />);

    expect(screen.queryByText(/^From:/)).toBeNull();
  });
});
