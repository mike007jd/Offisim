import { type SurfaceKey, useUiState } from '@/app/ui-state.js';
import { useCompanies, useProjects } from '@/data/queries.js';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/design-system/primitives/command.js';
import { Dialog, DialogContent } from '@/design-system/primitives/dialog.js';
import {
  Activity,
  BriefcaseBusiness,
  FolderGit2,
  LayoutGrid,
  type LucideIcon,
  Settings,
  Store,
  UsersRound,
} from 'lucide-react';
import { useEffect, useState } from 'react';

const SURFACES: ReadonlyArray<{ key: SurfaceKey; label: string; icon: LucideIcon }> = [
  { key: 'office', label: 'Office', icon: BriefcaseBusiness },
  { key: 'market', label: 'Market', icon: Store },
  { key: 'personnel', label: 'Personnel', icon: UsersRound },
  { key: 'activity', label: 'Activity', icon: Activity },
  { key: 'settings', label: 'Settings', icon: Settings },
  { key: 'studio', label: 'Studio', icon: LayoutGrid },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const setSurface = useUiState((s) => s.setSurface);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  function run(action: () => void) {
    action();
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showClose={false} className="off-command-dialog" aria-label="Command palette">
        <Command loop>
          <CommandInput placeholder="Jump to a surface, company, or project…" />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup heading="Go to">
              {SURFACES.map((surface) => (
                <CommandItem
                  key={surface.key}
                  value={`go ${surface.label}`}
                  onSelect={() => run(() => setSurface(surface.key))}
                >
                  <surface.icon />
                  {surface.label}
                </CommandItem>
              ))}
            </CommandGroup>
            {/* Mount the data-driven groups only while open so the company/project
                queries do not run on every session start (idiomatic enabled gate). */}
            {open ? <CommandDataGroups run={run} /> : null}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function CommandDataGroups({ run }: { run: (action: () => void) => void }) {
  const companyId = useUiState((s) => s.companyId);
  const setSurface = useUiState((s) => s.setSurface);
  const setCompany = useUiState((s) => s.setCompany);
  const setProject = useUiState((s) => s.setProject);

  const companies = useCompanies();
  const projects = useProjects(companyId);

  return (
    <>
      <CommandSeparator />
      <CommandGroup heading="Companies">
        {companies.data?.map((company) => (
          <CommandItem
            key={company.id}
            value={`company ${company.name}`}
            onSelect={() => run(() => setCompany(company.id))}
          >
            <BriefcaseBusiness />
            {company.name}
          </CommandItem>
        ))}
      </CommandGroup>
      {projects.data?.length ? (
        <>
          <CommandSeparator />
          <CommandGroup heading="Projects">
            {projects.data.map((project) => (
              <CommandItem
                key={project.id}
                value={`project ${project.name}`}
                onSelect={() =>
                  run(() => {
                    setProject(project.id);
                    setSurface('office');
                  })
                }
              >
                <FolderGit2 />
                {project.name}
              </CommandItem>
            ))}
          </CommandGroup>
        </>
      ) : null}
    </>
  );
}
