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

// Single-pass entity decoder so we don't accidentally re-decode an entity
// produced by a previous step (the classic `&amp;lt;` double-escape problem).
// `String.prototype.replace` matches non-overlapping substrings left to right,
// so each `&…;` in the source is recognised exactly once.
function decodeXmlEntities(s: string): string {
  return s.replace(
    /&(?:#(\d+);|#x([0-9a-fA-F]+);|(lt|gt|quot|apos|amp);)/g,
    (_match, dec: string | undefined, hex: string | undefined, named: string | undefined) => {
      if (dec) return String.fromCodePoint(Number(dec));
      if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
      switch (named) {
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        case 'quot':
          return '"';
        case 'apos':
          return "'";
        case 'amp':
          return '&';
        default:
          return _match;
      }
    },
  );
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
