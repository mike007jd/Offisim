import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SkillBindingList } from '../../components/employees/SkillBindingList';

describe('SkillBindingList', () => {
  it('renders skill metadata and lets the user toggle it', () => {
    const onEnabledChange = vi.fn();

    render(
      <SkillBindingList
        sourcePackageId="pkg.calendar"
        runtimeSkill={{
          skillName: 'calendar-skill',
          summary: 'Manages calendar operations',
          instructionMode: 'full',
          capabilityIndex: {
            capabilities: [
              { key: 'create_event', label: 'Create Event' },
              { key: 'list_events', label: 'List Events' },
            ],
          },
        }}
        enabled
        onEnabledChange={onEnabledChange}
      />,
    );

    expect(screen.getByText('calendar-skill')).toBeInTheDocument();
    expect(screen.getByText(/2 capabilities/i)).toBeInTheDocument();
    expect(screen.getByText(/full/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /disable skill/i }));
    expect(onEnabledChange).toHaveBeenCalledWith(false);
  });
});
