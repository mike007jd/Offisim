export async function overbroadWorkspaceReason(folder: string): Promise<string | null> {
  const trimmed = folder.trim();
  if (!trimmed) return null;

  const normalized = trimmed.replace(/\/+$/u, '') || '/';
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length < 2) {
    return `"${normalized}" is too broad to use as an AI workspace. Pick a specific project folder.`;
  }
  if (
    segments.length === 2 &&
    segments[0] === 'private' &&
    ['tmp', 'var', 'etc'].includes(segments[1] ?? '')
  ) {
    return `"${normalized}" is too broad to use as an AI workspace. Pick a specific project folder.`;
  }

  try {
    const { homeDir } = await import('@tauri-apps/api/path');
    const home = (await homeDir()).replace(/\/+$/u, '') || '/';
    const homeParent = home.replace(/\/[^/]+$/u, '') || '/';
    if (normalized === home) {
      return 'Your home folder is too broad to use as an AI workspace. Pick a specific project folder inside it.';
    }
    if (normalized === homeParent) {
      return 'The folder that contains your home folder is too broad to use as an AI workspace. Pick a specific project folder.';
    }
  } catch {
    // Path API unavailable outside desktop; Rust validates before any tool access.
  }

  return null;
}
