import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { CardBlock } from '@/design-system/grammar/CardBlock.js';
import { StatusPill } from '@/design-system/grammar/StatusPill.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Store, UsersRound } from 'lucide-react';

export function WorkspaceSurface() {
  return (
    <section className="off-framework-surface">
      <CardBlock>
        <CapsLabel>Framework Stack</CapsLabel>
        <div className="off-stack-row">
          <StatusPill tone="accent" running>
            ready
          </StatusPill>
          <span>React 19 · Tailwind v4 · shadcn/ui · assistant-ui · Motion</span>
        </div>
      </CardBlock>
      <CardBlock>
        <CapsLabel>Next Surface</CapsLabel>
        <div className="off-stack-grid">
          <div>
            <Icon icon={Store} />
            <span>Market inventory cards</span>
          </div>
          <div>
            <Icon icon={UsersRound} />
            <span>Personnel tri-pane</span>
          </div>
        </div>
      </CardBlock>
    </section>
  );
}
