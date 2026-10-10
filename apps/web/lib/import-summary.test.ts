import { describe, expect, it } from 'vitest';
import { importSummaryCsv } from './import-summary';

const AT = new Date('2026-10-10T06:00:00Z');

describe('import summary file', () => {
  it('lists the counts and then each problem', () => {
    const text = importSummaryCsv(
      'Product costs',
      {
        matched: 0,
        skipped: 1,
        invalid: 2,
        messages: ['Line 3: no variant 99', 'Line 4: bad cost "x"'],
      },
      AT,
    );
    expect(text.split('\r\n')).toEqual([
      '﻿Item,Value',
      'Import,Product costs',
      'Checked at (UTC),2026-10-10T06:00:00.000Z',
      'Rows matched,0',
      'Rows skipped,1',
      'Rows with a problem,2',
      '',
      'Problem',
      'Line 3: no variant 99',
      '"Line 4: bad cost ""x"""',
      '',
    ]);
  });

  it('says when more problems exist than were listed', () => {
    const text = importSummaryCsv(
      'Shipping rules',
      { matched: 0, skipped: 0, invalid: 5, messages: ['a', 'b'] },
      AT,
    );
    expect(text).toContain('3 more problem(s) are not listed');
  });

  it('keeps a hostile line from becoming a formula', () => {
    const text = importSummaryCsv(
      'Product costs',
      { matched: 0, skipped: 0, invalid: 1, messages: ['=HYPERLINK("x")'] },
      AT,
    );
    expect(text).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('has no problem lines for a clean file', () => {
    const text = importSummaryCsv(
      'Product costs',
      { matched: 4, skipped: 0, invalid: 0, messages: [] },
      AT,
    );
    expect(text.trimEnd().endsWith('Problem')).toBe(true);
    expect(text).toContain('Rows matched,4');
  });
});
