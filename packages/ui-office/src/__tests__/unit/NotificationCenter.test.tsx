import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NotificationCenter } from '../../components/notifications/NotificationCenter.js';

const dismiss = vi.fn();
const clearAll = vi.fn();
const markRead = vi.fn();

vi.mock('../../hooks/useNotifications', () => ({
  useNotifications: () => ({
    notifications: [],
    unreadCount: 0,
    markRead,
    dismiss,
    clearAll,
  }),
}));

vi.mock('../../components/notifications/NotificationCard', () => ({
  NotificationCard: () => <div>notification-card</div>,
}));

describe('NotificationCenter', () => {
  it('closes the popover when clicking outside', () => {
    render(<NotificationCenter />);

    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    expect(screen.getByText('Notifications')).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
  });

  it('exposes an Activity Log action and closes the popover after opening it', () => {
    const onOpenActivityLog = vi.fn();

    render(<NotificationCenter onOpenActivityLog={onOpenActivityLog} />);

    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Activity Log' }));

    expect(onOpenActivityLog).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
  });
});
