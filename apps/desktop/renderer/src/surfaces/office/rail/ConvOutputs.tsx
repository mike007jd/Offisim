import type { Deliverable, Employee } from '@/data/types.js';
import { BlockAvatar } from '@/design-system/grammar/BlockAvatar.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { initialsOf } from '@/lib/utils.js';
import { FileCode2, Plus } from 'lucide-react';

interface ConvOutputsProps {
  deliverables: Deliverable[];
  employeesById: Map<string, Employee>;
}

export function ConvOutputs({ deliverables, employeesById }: ConvOutputsProps) {
  if (deliverables.length === 0) return null;
  return (
    <section className="off-conv-outputs">
      <div className="off-rail-sec-head">
        Outputs
        <span className="off-rail-sec-count">{deliverables.length}</span>
        <span className="ml-auto">
          <IconButton icon={Plus} label="Add deliverable" variant="subtle" size="iconSm" />
        </span>
      </div>
      {deliverables.map((deliverable) => (
        <div key={deliverable.id} className="off-dlv">
          <Icon icon={FileCode2} size="sm" className="off-dlv-icon" />
          <span className="off-dlv-name">{deliverable.name}</span>
          <span className="off-dlv-contributors">
            {deliverable.contributorIds.map((id) => {
              const employee = employeesById.get(id);
              if (!employee) return null;
              return (
                <BlockAvatar
                  key={id}
                  initials={initialsOf(employee.name)}
                  colorA={employee.avatarA}
                  colorB={employee.avatarB}
                  size={20}
                  brand={employee.kind === 'external'}
                />
              );
            })}
          </span>
        </div>
      ))}
    </section>
  );
}
