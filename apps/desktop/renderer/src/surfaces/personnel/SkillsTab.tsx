import { useEmployeeSkills } from '@/data/queries.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { SkeletonRows } from '@/surfaces/shared/SurfaceStates.js';
import { Puzzle } from 'lucide-react';

interface SkillsTabProps {
  employeeId: string;
}

export function SkillsTab({ employeeId }: SkillsTabProps) {
  const skills = useEmployeeSkills(employeeId);

  return (
    <div className="off-pers-tab-shell">
      <div className="off-pers-tab-scroll">
        <CapsLabel>Skills</CapsLabel>
        {skills.isLoading ? (
          <SkeletonRows rows={3} />
        ) : !skills.data?.length ? (
          <div className="off-pers-sk-empty">
            <Icon icon={Puzzle} size="md" />
            <p>
              No skills available. Skills installed from the marketplace or created locally will
              appear here.
            </p>
          </div>
        ) : (
          skills.data.map((skill) => (
            <div key={skill.id} className="off-pers-skrow">
              <Icon icon={Puzzle} size="sm" />
              <div className="off-pers-skrow-main">
                <div className="off-pers-skrow-top">
                  <span className="off-pers-skrow-name">{skill.name}</span>
                  <span className="off-pers-scope-tag">
                    {skill.scope === 'employee' ? 'personal' : skill.scope}
                  </span>
                </div>
                <p className="off-pers-skrow-desc">{skill.description}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
