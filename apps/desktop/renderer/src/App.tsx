interface AppProps {
  onCompanySwitch: (id: string | null) => void;
}

export function App({ onCompanySwitch: _onCompanySwitch }: AppProps) {
  return <main data-offisim-design-reset-root="" />;
}
