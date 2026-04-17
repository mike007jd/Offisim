export interface ValidationBannerProps {
  warning: string | null;
}

export function ValidationBanner({ warning }: ValidationBannerProps) {
  if (!warning) return null;
  return (
    <div className="fixed bottom-12 left-1/2 -translate-x-1/2 z-[70] rounded-lg border border-amber-500/30 bg-amber-900/90 px-4 py-2 font-mono text-[11px] text-amber-300 shadow-lg">
      {warning}
    </div>
  );
}
