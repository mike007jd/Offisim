export interface ValidationBannerProps {
  warning: string | null;
}

export function ValidationBanner({ warning }: ValidationBannerProps) {
  if (!warning) return null;
  return (
    <div className="fixed bottom-12 left-1/2 z-top -translate-x-1/2 rounded-lg border border-warning/30 bg-warning-muted px-4 py-2 font-mono text-caption text-warning shadow-popover">
      {warning}
    </div>
  );
}
