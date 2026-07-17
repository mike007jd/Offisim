import { invokeCommand } from '@/lib/tauri-commands.js';
import { parseDocument } from '@offisim/core/browser';

type ProjectSkillSource = 'claude' | 'agents' | 'opencode';

export interface ProjectSkillDescriptor {
  id: string;
  name: string;
  description: string;
  relativePath: string;
  source: ProjectSkillSource;
}

const PROJECT_SKILL_ROOTS = [
  { path: '.claude/skills', source: 'claude' },
  { path: '.agents/skills', source: 'agents' },
  { path: '.opencode/skills', source: 'opencode' },
] as const;

function safeSkillDirectoryName(value: string): string | null {
  const name = value.trim();
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    return null;
  }
  return name;
}

function skillMetadata(
  content: string,
  fallbackName: string,
): Pick<ProjectSkillDescriptor, 'name' | 'description'> {
  try {
    const parsed = parseDocument(content).frontmatter;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    const frontmatter = parsed as Record<string, unknown>;
    const name = typeof frontmatter.name === 'string' ? frontmatter.name.trim() : '';
    const description =
      typeof frontmatter.description === 'string' ? frontmatter.description.trim() : '';
    return {
      name: name || fallbackName,
      description: description || 'Project-owned skill instructions.',
    };
  } catch {
    return { name: fallbackName, description: 'Project-owned skill instructions.' };
  }
}

async function discoverRoot(
  projectId: string,
  root: (typeof PROJECT_SKILL_ROOTS)[number],
): Promise<ProjectSkillDescriptor[]> {
  const directories = await invokeCommand('project_list_dir', {
    path: root.path,
    cwd: null,
    projectId,
  }).catch(() => []);
  const discovered = await Promise.all(
    directories
      .filter((entry) => entry.isDirectory && !entry.isSymlink)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry): Promise<ProjectSkillDescriptor | null> => {
        const directoryName = safeSkillDirectoryName(entry.name);
        if (!directoryName) return null;
        const skillDirectory = `${root.path}/${directoryName}`;
        const entries = await invokeCommand('project_list_dir', {
          path: skillDirectory,
          cwd: null,
          projectId,
        }).catch(() => []);
        if (!entries.some((candidate) => candidate.isFile && candidate.name === 'SKILL.md')) {
          return null;
        }
        const relativePath = `${skillDirectory}/SKILL.md`;
        const content = await invokeCommand('project_read_file', {
          path: relativePath,
          cwd: null,
          projectId,
        }).catch(() => null);
        if (content === null) return null;
        const metadata = skillMetadata(content, directoryName);
        return {
          id: `project:${root.source}:${relativePath}`,
          ...metadata,
          relativePath,
          source: root.source,
        };
      }),
  );
  return discovered.filter((skill): skill is ProjectSkillDescriptor => skill !== null);
}

/** Discover only repository-owned Agent Skills through the existing project sandbox commands. */
export async function discoverProjectSkills(projectId: string): Promise<ProjectSkillDescriptor[]> {
  const roots = await Promise.all(PROJECT_SKILL_ROOTS.map((root) => discoverRoot(projectId, root)));
  return roots.flat();
}
