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
      className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
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
