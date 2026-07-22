import { NAV_ENTRIES } from '@/app/nav-registry.js';
import { guardCurrentSurfaceScopeChange, useUiState } from '@/app/ui-state.js';
import { isTauriRuntime } from '@/data/adapters.js';
import { useCompanies, useProjects } from '@/data/queries.js';
import { queryKeys } from '@/data/query-keys.js';
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
import { type GlobalSearchResult, invokeCommand } from '@/lib/tauri-commands.js';
import { activateCompanyScope } from '@/runtime/activate-company-scope.js';
import { useQuery } from '@tanstack/react-query';
import {
  BriefcaseBusiness,
  FileText,
  FolderGit2,
  ListTodo,
  MessageSquareText,
  Plus,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

let commandCompanyActivationSeq = 0;

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const setSurface = useUiState((s) => s.setSurface);
  const openLifecycle = useUiState((s) => s.openLifecycle);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => {
          if (value) setSearchText('');
          return !value;
        });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  function run(action: () => void) {
    action();
    setOpen(false);
    setSearchText('');
  }

  function setPaletteOpen(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) setSearchText('');
  }

  return (
    <Dialog open={open} onOpenChange={setPaletteOpen}>
      <DialogContent showClose={false} className="off-command-dialog" aria-label="Command palette">
        <Command loop>
          <CommandInput
            value={searchText}
            onValueChange={setSearchText}
            placeholder="Search conversations, request cards, outputs, or jump to…"
          />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup heading="Go to">
              {NAV_ENTRIES.map((entry) => (
                <CommandItem
                  key={entry.key}
                  value={`go ${entry.key === 'studio' ? 'Office Studio editor' : entry.label}`}
                  onSelect={() => run(() => setSurface(entry.key))}
                >
                  <entry.icon />
                  {entry.key === 'studio' ? 'Office Studio editor' : entry.label}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Actions">
              <CommandItem
                value="new company create"
                onSelect={() => run(() => openLifecycle('create'))}
              >
                <Plus />
                New company
              </CommandItem>
            </CommandGroup>
            {/* Mount the data-driven groups only while open so the company/project
                queries do not run on every session start (idiomatic enabled gate). */}
            {open ? <CommandDataGroups run={run} searchText={searchText} /> : null}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function CommandDataGroups({
  run,
  searchText,
}: {
  run: (action: () => void) => void;
  searchText: string;
}) {
  const companyId = useUiState((s) => s.companyId);
  const projectId = useUiState((s) => s.projectId);
  const setSurface = useUiState((s) => s.setSurface);
  const setScope = useUiState((s) => s.setScope);
  const setProject = useUiState((s) => s.setProject);
  const requestThreadFocus = useUiState((s) => s.requestThreadFocus);
  const setStagePrimaryTab = useUiState((s) => s.setStagePrimaryTab);
  const highlightBoardRun = useUiState((s) => s.highlightBoardRun);
  const openStageView = useUiState((s) => s.openStageView);

  const companies = useCompanies();
  const projects = useProjects(companyId);
  const normalizedSearch = searchText.trim();
  const globalSearch = useQuery({
    queryKey: queryKeys.globalSearch(normalizedSearch),
    queryFn: () =>
      isTauriRuntime()
        ? invokeCommand('global_search', { query: normalizedSearch })
        : Promise.resolve([] as GlobalSearchResult[]),
    enabled: normalizedSearch.length >= 2,
    staleTime: 5_000,
  });

  async function navigateToSearchResult(result: GlobalSearchResult) {
    const seq = ++commandCompanyActivationSeq;
    try {
      if (result.companyId && result.companyId !== companyId) {
        const activated = await activateCompanyScope({
          companyId: result.companyId,
          setScope: (nextCompanyId, fallbackProjectId) =>
            setScope(nextCompanyId, result.projectId ?? fallbackProjectId),
          setSurface,
          surface: 'office',
          shouldCommit: () => seq === commandCompanyActivationSeq,
        });
        if (!activated || seq !== commandCompanyActivationSeq) return;
      } else {
        const activated = await guardCurrentSurfaceScopeChange('office', () => {
          if (result.projectId && result.projectId !== projectId) setProject(result.projectId);
          setSurface('office');
        });
        if (!activated || seq !== commandCompanyActivationSeq) return;
      }

      if (result.category === 'conversation') {
        if (!result.projectId || !result.threadId) {
          throw new Error('The source conversation no longer has a project location.');
        }
        requestThreadFocus({
          projectId: result.projectId,
          threadId: result.threadId,
          messageId: result.messageId,
        });
        return;
      }
      if (result.category === 'card') {
        if (!result.projectId) {
          throw new Error('The request card no longer has a project location.');
        }
        highlightBoardRun(result.entityId);
        setStagePrimaryTab('board');
        return;
      }
      openStageView({
        kind: 'preview',
        ref: {
          source: 'deliverable',
          deliverableId: result.entityId,
          threadId: result.threadId,
          name: result.title,
        },
        title: result.title,
      });
    } catch (error) {
      if (seq === commandCompanyActivationSeq) {
        toast.error(error instanceof Error ? error.message : 'Search result could not be opened');
      }
    }
  }

  const searchGroups = [
    {
      category: 'conversation' as const,
      heading: 'Conversations',
      icon: MessageSquareText,
    },
    { category: 'card' as const, heading: 'Request cards', icon: ListTodo },
    { category: 'output' as const, heading: 'Outputs', icon: FileText },
  ];

  return (
    <>
      {normalizedSearch.length >= 2
        ? searchGroups.map((group) => {
            const results = (globalSearch.data ?? []).filter(
              (result) => result.category === group.category,
            );
            if (results.length === 0) return null;
            return (
              <CommandGroup key={group.category} heading={group.heading}>
                {results.map((result) => (
                  <CommandItem
                    key={`${result.category}:${result.entityId}`}
                    value={[
                      result.category,
                      result.title,
                      result.snippet,
                      result.path,
                      result.companyName,
                      result.projectName,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onSelect={() => run(() => void navigateToSearchResult(result))}
                  >
                    <group.icon />
                    <span className="off-command-result-copy">
                      <span>{result.title}</span>
                      <small>{result.snippet}</small>
                    </span>
                    <span className="off-command-result-scope">
                      {[result.companyName, result.projectName].filter(Boolean).join(' / ')}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            );
          })
        : null}
      {normalizedSearch.length >= 2 && globalSearch.isError ? (
        <CommandGroup heading="Global search">
          <CommandItem disabled value="global search unavailable">
            Search is temporarily unavailable.
          </CommandItem>
        </CommandGroup>
      ) : null}
      <CommandSeparator />
      <CommandGroup heading="Companies">
        {companies.data?.map((company) => (
          <CommandItem
            key={company.id}
            value={`company ${company.name}`}
            onSelect={() =>
              run(() => {
                const seq = ++commandCompanyActivationSeq;
                void activateCompanyScope({
                  companyId: company.id,
                  setScope,
                  shouldCommit: () => seq === commandCompanyActivationSeq,
                }).catch((error) => {
                  if (seq === commandCompanyActivationSeq) {
                    toast.error(error instanceof Error ? error.message : 'Company switch failed');
                  }
                });
              })
            }
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
