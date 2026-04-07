import { fireEvent, render, screen } from '@testing-library/react';
import { Header } from '../../components/layout/Header.js';

describe('Header', () => {
  it('separates primary workspaces from right-side utilities', () => {
    const onOpenOffice = vi.fn();
    const onOpenSops = vi.fn();
    const onOpenMarket = vi.fn();
    const onOpenStudio = vi.fn();
    const onOpenSettings = vi.fn();

    render(
      <Header
        companyName="Offisim"
        onOpenSettings={onOpenSettings}
        onOpenStudio={onOpenStudio}
        onOpenMarket={onOpenMarket}
        onOpenOffice={onOpenOffice}
        onOpenSops={onOpenSops}
        onFileImport={vi.fn()}
        activeWorkspace="office"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Office workspace' }));
    fireEvent.click(screen.getByRole('button', { name: 'SOPs workspace' }));
    fireEvent.click(screen.getByRole('button', { name: 'Market utility' }));
    fireEvent.click(screen.getByRole('button', { name: 'Studio utility' }));
    fireEvent.click(screen.getByRole('button', { name: /settings/i }));

    expect(onOpenOffice).toHaveBeenCalledTimes(1);
    expect(onOpenSops).toHaveBeenCalledTimes(1);
    expect(onOpenMarket).toHaveBeenCalledTimes(1);
    expect(onOpenStudio).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
