import { WifiOff } from 'lucide-react';

export interface MarketErrorStateProps {
  readonly error: string;
  readonly onRetry: () => void;
}

export function MarketErrorState({ error, onRetry }: MarketErrorStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
      <WifiOff className="h-16 w-16 text-slate-500" />
      <h2 className="text-2xl font-bold text-white">Connection Lost</h2>
      <p className="max-w-md text-center text-sm text-slate-400">{error}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-xl bg-blue-500 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-400 animate-pulse"
      >
        Retry
      </button>
    </div>
  );
}
