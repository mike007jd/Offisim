import { resolveAvatarSeed } from '../../lib/avatar-seed';
import type { AgentState } from '../../runtime/use-agent-states';
import { BrandAvatar2D } from './BrandAvatar2D';
import { DicebearAvatar } from './DicebearAvatar';

interface EmployeeAvatarProps {
  /**
   * Accepts `AgentState` (runtime) or `EmployeeRow`-like (DB-shape). Internal
   * employees render via DiceBear-from-seed; external employees render the
   * brand SVG from `BrandRegistry`.
   */
  agent:
    | { isExternal: boolean; brandKey: string | null; name: string }
    | {
        is_external: number;
        brand_key: string | null;
        name: string;
        persona_json?: string | null;
      };
  size: number;
  className?: string;
}

export function EmployeeAvatar({ agent, size, className = '' }: EmployeeAvatarProps) {
  const isExternal = 'isExternal' in agent ? agent.isExternal : agent.is_external === 1;
  const brandKey = 'brandKey' in agent ? agent.brandKey : agent.brand_key;
  if (isExternal) {
    return <BrandAvatar2D brandKey={brandKey} size={size} className={className} />;
  }
  return (
    <DicebearAvatar seed={resolveAvatarSeed(agent as AgentState)} size={size} className={className} />
  );
}
