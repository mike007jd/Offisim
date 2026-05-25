import { useUiState } from '@/app/ui-state.js';
import { useEmployeeSkills, useEmployees } from '@/data/queries.js';
import type { Employee } from '@/data/types.js';
import { BlockAvatar } from '@/design-system/grammar/BlockAvatar.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { Chip } from '@/design-system/grammar/Chip.js';
import { FieldRow } from '@/design-system/grammar/FieldRow.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { SearchInput } from '@/design-system/grammar/SearchInput.js';
import { Select } from '@/design-system/grammar/Select.js';
import { StatusPill } from '@/design-system/grammar/StatusPill.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { Input } from '@/design-system/primitives/input.js';
import { Textarea } from '@/design-system/primitives/textarea.js';
import { cn, initialsOf } from '@/lib/utils.js';
import { EmptyState, SkeletonRows } from '@/surfaces/shared/SurfaceStates.js';
import { PanelLeftClose, PanelLeftOpen, Sparkles, UserPlus, UsersRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';

type InspectorTab = 'profile' | 'skills' | 'runtime';

function PersonnelList({ employees }: { employees: Employee[] }) {
  const selectedEmployeeId = useUiState((s) => s.selectedEmployeeId);
  const selectEmployee = useUiState((s) => s.selectEmployee);
  const collapsed = useUiState((s) => s.personnelRailCollapsed);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('all');

  const roles = useMemo(() => Array.from(new Set(employees.map((e) => e.role))), [employees]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return employees.filter(
      (e) => (role === 'all' || e.role === role) && (!q || e.name.toLowerCase().includes(q)),
    );
  }, [employees, query, role]);

  return (
    <>
      {!collapsed ? (
        <>
          <div className="off-pers-srch-row">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search people"
              className="flex-1"
            />
          </div>
          <div className="off-pers-filter">
            <Select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full"
              options={[
                { value: 'all', label: 'All roles' },
                ...roles.map((r) => ({ value: r, label: r })),
              ]}
            />
          </div>
        </>
      ) : null}

      <div className="off-pers-list">
        {filtered.length === 0 ? (
          <EmptyState
            icon={UsersRound}
            title="No people"
            description="Adjust your search or hire a new employee."
          />
        ) : (
          filtered.map((employee) => (
            <button
              type="button"
              key={employee.id}
              className={cn(
                'off-pers-emp off-focusable',
                employee.id === selectedEmployeeId && 'is-sel',
              )}
              onClick={() => selectEmployee(employee.id)}
            >
              <BlockAvatar
                initials={initialsOf(employee.name)}
                colorA={employee.avatarA}
                colorB={employee.avatarB}
                size={30}
                brand={employee.kind === 'external'}
              />
              <span className="off-pers-emp-info">
                <span className="off-pers-emp-name">{employee.name}</span>
                <span className="off-pers-emp-role">{employee.role}</span>
              </span>
            </button>
          ))
        )}
      </div>
    </>
  );
}

function ProfileTab({ employee }: { employee: Employee }) {
  return (
    <>
      <FieldRow label="Display name">
        {({ id }) => <Input id={id} defaultValue={employee.name} />}
      </FieldRow>
      <FieldRow label="Role">{({ id }) => <Input id={id} defaultValue={employee.role} />}</FieldRow>
      <FieldRow label="Discipline">
        {({ id }) => <Input id={id} defaultValue={employee.discipline} />}
      </FieldRow>
      <FieldRow label="System prompt" hint="Steers how this employee approaches work.">
        {({ id }) => (
          <Textarea
            id={id}
            rows={5}
            defaultValue={`You are ${employee.name}, the ${employee.role.toLowerCase()}. Focus on ${employee.discipline.toLowerCase()} and hand off clear, verifiable work.`}
          />
        )}
      </FieldRow>
      <div className="off-settings-actions">
        <Button variant="subtle" size="sm">
          Reset
        </Button>
        <Button size="sm">Save profile</Button>
      </div>
    </>
  );
}

function SkillsTab({ employeeId }: { employeeId: string }) {
  const skills = useEmployeeSkills(employeeId);
  if (skills.isLoading) return <SkeletonRows rows={3} />;
  if (!skills.data?.length) {
    return (
      <EmptyState
        icon={Sparkles}
        title="No skills"
        description="Install skills from the Market to extend this employee."
      />
    );
  }
  return (
    <>
      {skills.data.map((skill) => (
        <div key={skill.id} className="off-pers-skill">
          <Icon icon={Sparkles} size="sm" />
          <div className="off-pers-skill-main">
            <span className="off-pers-skill-name">{skill.name}</span>
            <p className="off-pers-skill-desc">{skill.description}</p>
          </div>
          <Chip>{skill.scope}</Chip>
        </div>
      ))}
    </>
  );
}

function RuntimeTab({ employee }: { employee: Employee }) {
  return (
    <>
      <FieldRow label="Model" hint="Routed through the Offisim harness.">
        {({ id }) => (
          <Select
            id={id}
            defaultValue={employee.modelLabel}
            options={[
              { value: 'MiniMax-M2.7', label: 'MiniMax-M2.7' },
              { value: 'Remote agent', label: 'Remote agent (A2A)' },
            ]}
          />
        )}
      </FieldRow>
      <FieldRow label="Runtime profile">
        {({ id }) => (
          <Select
            id={id}
            defaultValue={employee.kind === 'external' ? 'a2a' : 'harness'}
            options={[
              { value: 'harness', label: 'Offisim harness' },
              { value: 'a2a', label: 'External A2A agent' },
            ]}
          />
        )}
      </FieldRow>
    </>
  );
}

export function PersonnelSurface() {
  const employees = useEmployees();
  const selectedEmployeeId = useUiState((s) => s.selectedEmployeeId);
  const collapsed = useUiState((s) => s.personnelRailCollapsed);
  const setCollapsed = useUiState((s) => s.setPersonnelRailCollapsed);
  const [tab, setTab] = useState<InspectorTab>('profile');
  const listPanelRef = usePanelRef();

  const selected = employees.data?.find((e) => e.id === selectedEmployeeId) ?? null;

  const onToggleList = () => {
    if (collapsed) listPanelRef.current?.expand();
    else listPanelRef.current?.collapse();
  };

  if (employees.isLoading) {
    return (
      <div className="off-pers flex">
        <div className="off-pers-rail" style={{ width: 280 }}>
          <SkeletonRows rows={6} />
        </div>
      </div>
    );
  }

  return (
    <Group orientation="horizontal" className={cn('off-pers', collapsed && 'is-collapsed')}>
      <Panel
        panelRef={listPanelRef}
        className="off-pers-rail"
        defaultSize="20%"
        minSize="200px"
        collapsible
        collapsedSize="64px"
        onResize={(size) => setCollapsed(size.inPixels < 120)}
      >
        <div className="off-pers-rail-head">
          <div className="off-pers-srch-row">
            <IconButton
              icon={collapsed ? PanelLeftOpen : PanelLeftClose}
              label={collapsed ? 'Expand list' : 'Collapse list'}
              variant="subtle"
              size="iconSm"
              onClick={onToggleList}
            />
            {!collapsed ? (
              <span className="off-pers-emp-name ml-[2px] flex-1">
                {employees.data?.length ?? 0} people
              </span>
            ) : null}
            <IconButton icon={UserPlus} label="Hire employee" variant="subtle" size="iconSm" />
          </div>
        </div>
        <PersonnelList employees={employees.data ?? []} />
      </Panel>

      <Separator className="off-resize-handle" />

      <Panel className="off-pers-detail" defaultSize="50%" minSize="34%">
        {selected ? (
          <>
            <header className="off-pers-detail-head">
              <BlockAvatar
                initials={initialsOf(selected.name)}
                colorA={selected.avatarA}
                colorB={selected.avatarB}
                size={56}
                brand={selected.kind === 'external'}
              />
              <div className="off-pers-id">
                <h2 className="off-pers-name">{selected.name}</h2>
                <span className="off-pers-role">{selected.role}</span>
              </div>
              <div className="flex flex-wrap justify-end gap-[var(--off-sp-2)]">
                <StatusPill tone={selected.online ? 'ok' : 'muted'} running={selected.online}>
                  {selected.online ? 'online' : 'idle'}
                </StatusPill>
                {selected.brandLabel ? <Chip>{selected.brandLabel}</Chip> : null}
              </div>
            </header>
            <div className="off-pers-detail-body">
              <section className="off-pers-prof-sec">
                <CapsLabel>Overview</CapsLabel>
                <div className="off-card-section-body">
                  <div className="off-about-row">
                    <span>Discipline</span>
                    <span>{selected.discipline}</span>
                  </div>
                  <div className="off-about-row">
                    <span>Model</span>
                    <span>{selected.modelLabel}</span>
                  </div>
                  <div className="off-about-row">
                    <span>Skills</span>
                    <span>{selected.skillCount}</span>
                  </div>
                  <div className="off-about-row">
                    <span>Type</span>
                    <span>{selected.kind === 'external' ? 'External (A2A)' : 'Internal'}</span>
                  </div>
                </div>
              </section>
            </div>
          </>
        ) : (
          <EmptyState
            icon={UsersRound}
            title="Select an employee"
            description="Pick someone from the list to view and edit their profile."
          />
        )}
      </Panel>

      <Separator className="off-resize-handle" />

      <Panel className="off-pers-insp" defaultSize="30%" minSize="22%">
        {selected ? (
          <>
            <div className="off-pers-insp-tabs">
              {(['profile', 'skills', 'runtime'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={cn('off-pers-tab off-focusable', tab === key && 'is-active')}
                  onClick={() => setTab(key)}
                >
                  {key[0]?.toUpperCase()}
                  {key.slice(1)}
                </button>
              ))}
            </div>
            <div className="off-pers-insp-scroll" key={selected.id}>
              {tab === 'profile' ? <ProfileTab employee={selected} /> : null}
              {tab === 'skills' ? <SkillsTab employeeId={selected.id} /> : null}
              {tab === 'runtime' ? <RuntimeTab employee={selected} /> : null}
            </div>
          </>
        ) : null}
      </Panel>
    </Group>
  );
}
