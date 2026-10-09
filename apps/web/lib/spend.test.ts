import { describe, expect, it } from 'vitest';
import { parseSpendLines } from './spend';

describe('parseSpendLines', () => {
  it('reads full lines, two-column lines and skips a header and blank lines', () => {
    const r = parseSpendLines(
      'date,campaign,spend,sales\n2026-10-01, Autumn, 120.50, 400\n\n2026-10-02, 30\n2026-10-03\tBrand\t12',
    );
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { date: '2026-10-01', campaign: 'Autumn', spend: '120.50', reportedSales: '400' },
      { date: '2026-10-02', campaign: '', spend: '30' },
      { date: '2026-10-03', campaign: 'Brand', spend: '12' },
    ]);
  });

  it('names the line of each problem and keeps the good lines', () => {
    const r = parseSpendLines(
      '2026-10-01, A, 5\nOct 2, A, 5\n2026-10-03, A, five\n2026-10-04, A, 5, x',
    );
    expect(r.rows).toHaveLength(1);
    expect(r.errors).toEqual([
      'Line 2: use a date like 2026-10-01',
      'Line 3: spend must be a number',
      'Line 4: reported sales must be a number',
    ]);
  });

  it('rejects negatives and exponents', () => {
    expect(parseSpendLines('2026-10-01, A, -5').errors).toHaveLength(1);
    expect(parseSpendLines('2026-10-01, A, 1e3').errors).toHaveLength(1);
  });

  it('an empty paste has no rows and no errors', () => {
    expect(parseSpendLines('  \n ')).toEqual({ rows: [], errors: [] });
  });
});
