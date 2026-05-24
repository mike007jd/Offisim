export interface ValidationBannerProps {
  warning: string | null;
}

export function ValidationBanner({ warning }: ValidationBannerProps) {
  if (!warning) return null;
  return (
    <div className="fixed bottom-12 left-1/2 z-top -translate-x-1/2 rounded-r-md border border-warn/30 bg-warn-surface px-sp-4 py-sp-2 font-mono text-fs-micro text-warn shadow-popover">
      {warning}
    </div>
  );
}
