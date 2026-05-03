import { isTauri } from './env.js';

/**
 * Save a JSON text payload to disk. Tauri path opens a save dialog and writes
 * the file via `@tauri-apps/plugin-fs`; web path triggers a Blob download.
 *
 * Both paths return the saved filename (or `null` if the user cancelled the
 * Tauri save dialog). Throws on write failure.
 */
export async function exportJsonText(filename: string, json: string): Promise<string | null> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const target = (await save({
      defaultPath: filename,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })) as string | null;
    if (!target) return null;
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(target, json);
    return target;
  }

  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
  return filename;
}
