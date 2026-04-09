import { fireEvent, render, screen } from '@testing-library/react';
import { Header } from '../../components/layout/Header.js';

describe('Header', () => {
  const baseProps = {
    companyName: 'Offisim',
    onOpenSettings: vi.fn(),
    onOpenStudio: vi.fn(),
    onOpenMarket: vi.fn(),
    onOpenOffice: vi.fn(),
    onOpenSops: vi.fn(),
    onFileImport: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('separates primary workspaces from right-side utilities', () => {
    render(<Header {...baseProps} activeWorkspace="office" />);

    fireEvent.click(screen.getByRole('button', { name: 'Office workspace' }));
    fireEvent.click(screen.getByRole('button', { name: 'SOPs workspace' }));
    fireEvent.click(screen.getByRole('button', { name: 'Market utility' }));
    fireEvent.click(screen.getByRole('button', { name: 'Studio utility' }));
    fireEvent.click(screen.getByRole('button', { name: /settings/i }));

    expect(baseProps.onOpenOffice).toHaveBeenCalledTimes(1);
    expect(baseProps.onOpenSops).toHaveBeenCalledTimes(1);
    expect(baseProps.onOpenMarket).toHaveBeenCalledTimes(1);
    expect(baseProps.onOpenStudio).toHaveBeenCalledTimes(1);
    expect(baseProps.onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('hides Studio nav item when active workspace is not office', () => {
    render(<Header {...baseProps} activeWorkspace="sops" />);

    expect(screen.queryByRole('button', { name: 'Studio utility' })).not.toBeInTheDocument();
  });

  it('shows Studio nav item when active workspace is office', () => {
    render(<Header {...baseProps} activeWorkspace="office" />);

    expect(screen.getByRole('button', { name: 'Studio utility' })).toBeInTheDocument();
  });

  it('visually indicates the active workspace in primary nav and utility area', () => {
    const { rerender } = render(<Header {...baseProps} activeWorkspace="office" />);

    const officeBtn = screen.getByRole('button', { name: 'Office workspace' });
    expect(officeBtn.className).toContain('bg-blue-500/15');

    // SOPs is now an icon button in the utility area — uses cyan highlight
    const sopsBtn = screen.getByRole('button', { name: 'SOPs workspace' });
    expect(sopsBtn.className).not.toContain('bg-cyan-500/15');

    rerender(<Header {...baseProps} activeWorkspace="sops" />);

    const officeBtn2 = screen.getByRole('button', { name: 'Office workspace' });
    expect(officeBtn2.className).not.toContain('bg-blue-500/15');

    const sopsBtn2 = screen.getByRole('button', { name: 'SOPs workspace' });
    expect(sopsBtn2.className).toContain('bg-cyan-500/15');
  });
});
