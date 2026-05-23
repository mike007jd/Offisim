import { CHAT_ATTACHMENT_MAX_BYTES } from '@offisim/shared-types';

type TauriFsModule = {
  readFile: (path: string) => Promise<Uint8Array<ArrayBuffer>>;
  stat: (path: string) => Promise<{ isFile: boolean; isDirectory: boolean; size: number }>;
};

export interface TauriDroppedFileReadResult {
  files: File[];
  errors: Array<{ filename: string; message: string }>;
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  csv: 'text/csv',
  css: 'text/css',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  gif: 'image/gif',
  htm: 'text/html',
  html: 'text/html',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'application/javascript',
  json: 'application/json',
  md: 'text/markdown',
  markdown: 'text/markdown',
  pdf: 'application/pdf',
  png: 'image/png',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  rtf: 'text/rtf',
  ts: 'application/typescript',
  txt: 'text/plain',
  webp: 'image/webp',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xml: 'application/xml',
  yaml: 'application/yaml',
  yml: 'application/yaml',
};

function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/u, '');
  return trimmed.split(/[\\/]/u).filter(Boolean).at(-1) ?? 'attachment';
}

function mimeFromPath(path: string): string {
  const name = basename(path);
  const ext = name.includes('.') ? name.split('.').at(-1)?.toLowerCase() : undefined;
  return ext ? (MIME_BY_EXTENSION[ext] ?? 'application/octet-stream') : 'application/octet-stream';
}

function failureMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function readTauriDroppedFiles(
  paths: readonly string[],
): Promise<TauriDroppedFileReadResult> {
  const fs = (await import('@tauri-apps/plugin-fs')) as TauriFsModule;
  const files: File[] = [];
  const errors: TauriDroppedFileReadResult['errors'] = [];

  for (const path of paths) {
    const filename = basename(path);
    try {
      const info = await fs.stat(path);
      if (!info.isFile) {
        errors.push({
          filename,
          message: `${filename}: folders cannot be attached here`,
        });
        continue;
      }
      if (info.size > CHAT_ATTACHMENT_MAX_BYTES) {
        errors.push({
          filename,
          message: `${filename}: exceeds the 8 MB per-file limit`,
        });
        continue;
      }
      const bytes = await fs.readFile(path);
      const mimeType = mimeFromPath(path);
      files.push(new File([bytes], filename, { type: mimeType }));
    } catch (err) {
      errors.push({
        filename,
        message: `${filename}: failed to read dropped file (${failureMessage(err)})`,
      });
    }
  }

  return { files, errors };
}
