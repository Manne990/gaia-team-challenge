import { describe, expect, it } from 'vitest';
import { escapeCsv, parseCsv } from '../../src/imports/csv.mjs';

describe('CSV safety helpers', () => {
  it('parses quoted UTF-8 fields and rejects malformed quoting', () => {
    expect(parseCsv('Name,Description\nAcme,"A, B"\n')).toEqual({
      headers: ['name', 'description'],
      rows: [['Acme', 'A, B']],
    });
    expect(() => parseCsv('Name\n"unterminated')).toThrow('unterminated');
  });

  it('escapes spreadsheet formulas and CSV syntax on export', () => {
    expect(escapeCsv('=2+2')).toBe("'=2+2");
    expect(escapeCsv('A, B')).toBe('"A, B"');
  });

  it('rejects oversized input before parsing it', () => {
    expect(() => parseCsv(`name\n${'x'.repeat(1_000_000)}`)).toThrow('too large');
  });
});
