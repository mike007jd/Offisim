#!/usr/bin/env node
/**
 * Generate deterministic fixtures for the doc-engine importers harness.
 * Re-runnable; outputs land in `packages/doc-engine/harness/fixtures/`.
 *
 * Why generate instead of checking in static binaries?
 *   - DOCX / PPTX / PDF / XLSX bytes drift across encoder versions; a checked-in
 *     binary would diff-noise the repo on every Office-tools bump.
 *   - We want fixtures to roughly track what the production exporters emit, so
 *     parser output is anchored to "what users actually attach".
 *
 * The generator is intentionally Node-only and uses the same packages already
 * in `@offisim/doc-engine`'s dependency tree.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(HERE, 'fixtures');

async function ensureDir() {
  await mkdir(FIXTURES_DIR, { recursive: true });
}

async function writeFixture(name, bytes) {
  await writeFile(resolve(FIXTURES_DIR, name), bytes);
  console.log(`  wrote ${name} (${bytes.length} bytes)`);
}

async function generatePdf() {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 12; i += 1) {
    const page = pdf.addPage([400, 300]);
    page.drawText(`Sample page ${i}`, { x: 40, y: 250, size: 18, font });
    page.drawText(`This is fixture text used by the doc-engine harness — page ${i} of 12.`, {
      x: 40,
      y: 220,
      size: 10,
      font,
    });
  }
  const bytes = await pdf.save();
  await writeFixture('sample.pdf', Buffer.from(bytes));
}

async function generateDocx() {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = await import('docx');
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: 'Doc-Engine Fixture', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({
            children: [
              new TextRun('First paragraph of the docx fixture used to verify mammoth output.'),
            ],
          }),
          new Paragraph({
            children: [new TextRun('Second paragraph — text only, no images, no tables.')],
          }),
        ],
      },
    ],
  });
  const buf = await Packer.toBuffer(doc);
  await writeFixture('sample.docx', buf);
}

async function generateXlsx() {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const sheetA = XLSX.utils.aoa_to_sheet([
    ['Name', 'Score'],
    ['Alice', 88],
    ['Bob', 92],
  ]);
  const sheetB = XLSX.utils.aoa_to_sheet([
    ['Quarter', 'Revenue'],
    ['Q1', 1000],
    ['Q2', 1200],
    ['Q3', 900],
  ]);
  const sheetC = XLSX.utils.aoa_to_sheet([['Notes'], ['fixture row 1'], ['fixture row 2']]);
  XLSX.utils.book_append_sheet(wb, sheetA, 'Scores');
  XLSX.utils.book_append_sheet(wb, sheetB, 'Revenue');
  XLSX.utils.book_append_sheet(wb, sheetC, 'Notes');
  const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  await writeFixture('sample.xlsx', Buffer.from(out));
}

async function generatePptx() {
  const pptxImport = await import('pptxgenjs');
  const PptxGenJS = pptxImport.default ?? pptxImport;
  const pres = new PptxGenJS();
  for (let i = 1; i <= 5; i += 1) {
    const slide = pres.addSlide();
    slide.addText(`Slide ${i} title`, { x: 0.5, y: 0.5, fontSize: 24 });
    slide.addText(`Body text for slide ${i} of 5 — fixture content.`, {
      x: 0.5,
      y: 1.5,
      fontSize: 14,
    });
  }
  const buf = await pres.write('arraybuffer');
  await writeFixture('sample.pptx', Buffer.from(buf));
}

function generatePng(width, height) {
  // Minimal PNG: signature + IHDR + IDAT (single zero scanline filter) + IEND.
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // colour type (grayscale)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  // Raw image bytes: per scanline a filter byte (0) followed by `width` bytes.
  const raw = Buffer.alloc(height * (1 + width), 128); // grey fill (already 128 default? Buffer.alloc fills with 0)
  raw.fill(0); // explicit
  for (let row = 0; row < height; row += 1) {
    raw[row * (1 + width)] = 0; // filter byte
  }
  const idatData = zlib.deflateSync(raw);
  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idatData),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

async function generatePngFixture() {
  const png = generatePng(1024, 768);
  await writeFixture('screenshot.png', png);
}

async function generateMarkdown() {
  const md = `# Doc-Engine Fixture\n\nThis markdown file is used to verify that text-like attachments\nflow through the parser as \`{ kind: 'text' }\`.\n\n- bullet one\n- bullet two\n`;
  await writeFixture('sample.md', Buffer.from(md, 'utf8'));
}

async function generateCsv() {
  const csv = 'name,score\nAlice,88\nBob,92\n';
  await writeFixture('sample.csv', Buffer.from(csv, 'utf8'));
}

async function generateGarbagePdf() {
  // PDF magic header with random tail — should fail pdfjs parse and surface
  // `{ kind: 'unsupported', reason: ... }` from the importer.
  const header = Buffer.from('%PDF-1.4\n', 'utf8');
  const garbage = Buffer.from(
    'this is not a valid pdf body — corrupted bytes follow.\n00\nxref\nbroken',
  );
  await writeFixture('garbage.pdf', Buffer.concat([header, garbage]));
}

async function main() {
  await ensureDir();
  console.log(`Writing fixtures to ${FIXTURES_DIR}`);
  await generatePdf();
  await generateDocx();
  await generateXlsx();
  await generatePptx();
  await generatePngFixture();
  await generateMarkdown();
  await generateCsv();
  await generateGarbagePdf();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
