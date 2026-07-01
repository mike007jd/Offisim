import type { Employee } from '@/data/types.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Bot, Lock, ShieldCheck } from 'lucide-react';

interface RuntimeTabProps {
  employee: Employee;
}

/** How this employee runs. The honest state is a single status row — the prior
 *  six disabled "binding option" cards and decorative Gate badges were fake
 *  controls (read-only, no persistence) and are gone. */
export function RuntimeTab({ employee }: RuntimeTabProps) {
  if (employee.kind === 'external') {
    return (
      <div className="off-pers-tab-shell">
        <div className="off-pers-tab-scroll">
          <CapsLabel>Execution binding</CapsLabel>
          <div className="off-pers-lock-note">
            <Icon icon={Lock} size="sm" />
            External A2A peer · brand endpoint owned.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="off-pers-tab-shell">
      <div className="off-pers-tab-scroll">
        <CapsLabel>Execution binding</CapsLabel>
        <div className="off-pers-runtime-head">
          <span className="off-pers-runtime-ic">
            <Icon icon={Bot} size="sm" />
          </span>
          <div>
            <div className="off-pers-runtime-title">Pi Agent runtime</div>
            <div className="off-pers-runtime-sub">{employee.modelLabel} · company default</div>
          </div>
          <span className="off-pers-runtime-ok">
            <Icon icon={ShieldCheck} size="sm" />
            Tools isolated
          </span>
        </div>
      </div>
    </div>
  );
}
