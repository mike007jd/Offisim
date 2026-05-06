import type { ParsedAttachment } from '@offisim/shared-types';

const SLIDE_PATH_RE = /^ppt\/slides\/slide(\d+)\.xml$/;

/** Extract `<a:t>...</a:t>` text nodes via regex walk — Node + browser safe. */
function extractText(xml: string): string {
  const out: string[] = [];
  const re = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;
  re.lastIndex = 0;
  let m = re.exec(xml);
  while (m !== null) {
    out.push(decodeXmlEntities(m[1] ?? ''));
    m = re.exec(xml);
  }
  return out.join('');
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

export async function parsePptx(bytes: Uint8Array): Promise<ParsedAttachment> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(bytes);
  const entries: Array<{ index: number; xml: string }> = [];
  for (const path of Object.keys(zip.files)) {
    const match = SLIDE_PATH_RE.exec(path);
    if (!match || !match[1]) continue;
    const file = zip.file(path);
    if (!file) continue;
    const xml = await file.async('text');
    entries.push({ index: Number(match[1]), xml });
  }
  entries.sort((a, b) => a.index - b.index);
  const slides = entries.map((e) => extractText(e.xml));
  return {
    kind: 'pptx',
    slides,
    text: slides.join('\n\n'),
  };
}
