import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('web test setup', () => {
  it('loads jest-dom matchers for DOM assertions', () => {
    render(<div>Hello setup</div>);

    expect(screen.getByText('Hello setup')).toBeInTheDocument();
  });
});
