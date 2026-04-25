import type { EmployeeAppearance } from '@offisim/shared-types';
import { parseEmployeePersona } from '@offisim/shared-types';
import { BrandAvatar2D } from './BrandAvatar2D';
import { DicebearAvatar } from './DicebearAvatar';

type AgentLikeRuntime = {
  isExternal: boolean;
  brandKey: string | null;
  name: string;
  avatarSeed: string;
  appearance: EmployeeAppearance | null;
};

type AgentLikeRow = {
  is_external: number;
  brand_key: string | null;
  name: string;
  persona_json?: string | null;
};

interface EmployeeAvatarProps {
  /**
   * Accepts `AgentState` (runtime, pre-resolved) or `EmployeeRow`-like
   * (DB-shape, parsed lazily). Internal employees render via DiceBear with
   * appearance layered on; external employees render the brand SVG.
   */
  agent: AgentLikeRuntime | AgentLikeRow;
  size: number;
  className?: string;
}

export function EmployeeAvatar({ agent, size, className = '' }: EmployeeAvatarProps) {
  const isRuntime = 'isExternal' in agent;
  const isExternal = isRuntime ? agent.isExternal : agent.is_external === 1;
  const brandKey = isRuntime ? agent.brandKey : agent.brand_key;
  if (isExternal) {
    return <BrandAvatar2D brandKey={brandKey} size={size} className={className} />;
  }
  if (isRuntime) {
    return (
      <DicebearAvatar
        seed={agent.avatarSeed}
        size={size}
        className={className}
        appearance={agent.appearance}
      />
    );
  }
  const persona = parseEmployeePersona(agent.persona_json ?? null);
  return (
    <DicebearAvatar
      seed={persona.avatarSeed ?? agent.name}
      size={size}
      className={className}
      appearance={persona.appearance ?? null}
    />
  );
}
