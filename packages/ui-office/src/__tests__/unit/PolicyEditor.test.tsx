import { fireEvent, render, screen } from '@testing-library/react';
import { PolicyEditor } from '../../components/company/PolicyEditor.js';

describe('PolicyEditor', () => {
  it('renders the new defaults surface and clamps temperature input to the supported range', () => {
    const onChange = vi.fn();

    render(
      <PolicyEditor
        policy={{
          defaultModel: 'MiniMax-M1',
          defaultTemperature: 0.7,
          defaultMaxTokens: 4096,
        }}
        onChange={onChange}
      />,
    );

    expect(screen.getByLabelText('Default Model Profile')).toHaveValue('MiniMax-M1');
    expect(screen.getByLabelText('Temperature value')).toHaveValue(0.7);
    expect(screen.getByText('These defaults apply to newly created employees only.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Temperature value'), {
      target: { value: '3' },
    });

    expect(onChange).toHaveBeenCalledWith({
      defaultModel: 'MiniMax-M1',
      defaultTemperature: 2,
      defaultMaxTokens: 4096,
    });
  });
});
