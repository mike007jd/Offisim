import { ShieldCheck } from 'lucide-react';

interface Props {
  handle: string;
  display_name: string;
  verification_state: string;
}

export function CreatorBadge({ handle, verification_state }: Props) {
  return (
    <a
      href={`/creator/${handle}`}
      className="inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
    >
      <span>@{handle}</span>
      {verification_state === 'verified' && (
        <ShieldCheck size={14} className="text-blue-500" aria-label="Verified creator" />
      )}
      {verification_state === 'trusted' && (
        <ShieldCheck size={14} className="text-green-500" aria-label="Trusted creator" />
      )}
    </a>
  );
}
