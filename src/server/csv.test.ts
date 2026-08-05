import assert from 'node:assert/strict';
import test from 'node:test';
import { escapeCsvCell, parseCsv, previewCsv, renderCsv } from './csv.js';

test('CSV preview normalizes contact emails and retains row-specific errors', () => {
  const rows = previewCsv(
    'contacts',
    'first name,last name,email\nAda,Lovelace,ADA@EXAMPLE.TEST\n,Missing,nope',
  );
  assert.equal(rows[0]?.values.email, 'ada@example.test');
  assert.equal(rows[1]?.status, 'error');
});

test('CSV parser handles quoted cells and rejects malformed input', () => {
  assert.deepEqual(parseCsv('name,note\nAcme,"hello, world"'), [
    ['name', 'note'],
    ['Acme', 'hello, world'],
  ]);
  assert.throws(() => parseCsv('name\n"broken'), /unclosed/i);
});

test('CSV export safely escapes formula-like values', () => {
  assert.equal(escapeCsvCell('=SUM(A1:A2)'), "'=SUM(A1:A2)");
  assert.equal(renderCsv(['name'], [{ name: 'a,b' }]), 'name\r\n"a,b"');
});
