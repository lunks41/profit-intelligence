import type { LtvCohort } from '@pi/contracts';
import type { CohortMonthRow, CohortSummaryRow } from '@pi/db';
import { dec, toStored } from '@pi/profit-engine';

const monthIndex = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;

/**
 * Builds the cohort table: per first-order month the customers, the share that came back, revenue and profit per
 * customer month by month (cumulative, up to `currentMonth`), the ad spend of that month and what a customer cost.
 * `adByMonth` is ad spend in USD per YYYY-MM; a month with no spend entry has no CAC.
 */
export function buildCohorts(
  summary: CohortSummaryRow[],
  cells: CohortMonthRow[],
  adByMonth: Map<string, string>,
  currentMonth: string,
): LtvCohort[] {
  return summary.map((c) => {
    const customers = dec(String(c.customers));
    const mine = cells.filter((x) => x.cohort === c.month);
    const first = monthIndex(c.month);
    const last = monthIndex(currentMonth);
    const cumulative: LtvCohort['cumulative'] = [];
    let rev = dec('0');
    let profit = dec('0');
    for (let k = 0; first + k <= last; k++) {
      const cell = mine.find((x) => monthIndex(x.month) === first + k);
      if (cell) {
        rev = rev.plus(dec(cell.revenue));
        profit = profit.plus(dec(cell.profit));
      }
      cumulative.push({
        ltv: toStored(rev.div(customers)),
        profitLtv: toStored(profit.div(customers)),
      });
    }
    const revenue = mine.reduce((t, x) => t.plus(dec(x.revenue)), dec('0'));
    const ltv = revenue.div(customers);
    const profitLtv = mine.reduce((t, x) => t.plus(dec(x.profit)), dec('0')).div(customers);
    const spend = adByMonth.get(c.month) ?? null;
    const cac = spend === null ? null : dec(spend).div(customers);
    const ratio = cac && !cac.isZero() ? ltv.div(cac) : null;
    return {
      month: c.month,
      customers: c.customers,
      repurchaseRate: dec(String(c.repurchasers)).div(customers).toDecimalPlaces(4).toFixed(4),
      revenue: toStored(revenue),
      ltv: toStored(ltv),
      profitLtv: toStored(profitLtv),
      adSpend: spend,
      cac: cac ? toStored(cac) : null,
      ratio: ratio ? ratio.toDecimalPlaces(2).toFixed(2) : null,
      cumulative,
    };
  });
}
