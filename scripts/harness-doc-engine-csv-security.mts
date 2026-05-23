import { exportDocument } from '../packages/doc-engine/src/export.js';

const result = await exportDocument(
  {
    title: '=HYPERLINK("https://attacker.example","open")',
    content: [
      '# =SUM(1,1)',
      '=cmd|"/C calc"!A0',
      'normal line',
      '## @malicious',
      '+SUM(2,2)',
      '-10+20',
    ].join('\n'),
    contributors: [{ name: '@attacker' }, { name: 'normal' }],
    createdAt: Date.UTC(2026, 4, 22),
  },
  'csv',
);

const csv = await result.blob.text();
const rows = parseCsvRows(csv);

for (const row of rows) {
  for (const value of row) {
    if (typeof value !== 'string') continue;
    if (/^[\s]*[=+\-@]/u.test(value)) {
      throw new Error(`CSV formula cell was not neutralized: ${value}`);
    }
  }
}

if (!csv.includes("'=HYPERLINK") || !csv.includes("'@attacker") || !csv.includes("'+SUM")) {
  throw new Error('CSV output does not contain expected formula neutralization prefixes');
}

console.log('Doc engine CSV security harness passed.');

function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const next = csvText[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }

  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
