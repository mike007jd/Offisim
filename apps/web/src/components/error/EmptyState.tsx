import { MessageSquare, Settings } from 'lucide-react';

interface EmptyStateProps {
  isConfigured: boolean;
  onOpenSettings: () => void;
}

export function EmptyState({ isConfigured, onOpenSettings }: EmptyStateProps) {
  if (!isConfigured) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-text-muted">
        <Settings className="h-10 w-10" />
        <div className="text-center">
          <p className="font-medium">No provider configured</p>
          <p className="text-sm mt-1">
            <button onClick={onOpenSettings} className="text-accent hover:underline">
              Open settings
            </button>{' '}
            to configure your LLM provider.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-text-muted">
      <MessageSquare className="h-10 w-10" />
      <div className="text-center">
        <p className="font-medium">Send a message to your AI company</p>
        <p className="text-sm mt-1">
          Your team is ready: Alice (Manager), Bob (Developer), Carol (Designer)
        </p>
      </div>
    </div>
  );
}
