const MAX_BYTES = 1_000_000;
const MAX_ROWS = 1_000;

export function parseCsv(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('CSV content is required.');
  if (Buffer.byteLength(source, 'utf8') > MAX_BYTES) throw new Error('CSV file is too large.');
  const text = source.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
      continue;
    }
    if (character === '"') {
      if (field) throw new Error('Invalid quoted CSV field.');
      quoted = true;
    } else if (character === ',') {
      row.push(field.trim());
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = '';
    } else field += character;
  }
  if (quoted) throw new Error('CSV has an unterminated quoted field.');
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) throw new Error('CSV needs a header and at least one data row.');
  if (rows.length - 1 > MAX_ROWS) throw new Error('CSV contains too many rows.');
  const headers = rows.shift().map((header) => header.toLowerCase().replace(/[^a-z0-9]+/g, ''));
  if (!headers.every(Boolean) || new Set(headers).size !== headers.length)
    throw new Error('CSV headers must be unique and non-empty.');
  return { headers, rows };
}

export function escapeCsv(value) {
  const text = String(value ?? '');
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function normalizeTags(value) {
  return String(value || '')
    .split(/[;,|]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 20);
}
