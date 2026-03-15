import { PLATFORM_API_URL } from './config.js';

/** Fetch artifact URL and trigger browser download for a package version. */
export async function downloadArtifact(packageVersionId: string): Promise<void> {
  const res = await fetch(
    `${PLATFORM_API_URL}/v1/install/download/${encodeURIComponent(packageVersionId)}`,
    { credentials: 'include' },
  );

  if (!res.ok) {
    throw new Error(`Download failed: ${res.status}`);
  }

  const data = (await res.json()) as { artifact_url?: string };
  if (!data.artifact_url) {
    throw new Error('No artifact available for this version');
  }

  const a = document.createElement('a');
  a.href = data.artifact_url;
  a.download = '';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
