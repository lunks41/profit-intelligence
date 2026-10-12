/**
 * What the merchant is told, in the notification bell, after they change something: a cost saved, a rule added, an
 * expense removed. One list keyed by method and route, so every change is covered in one place and the wording
 * stays alike. Reads, previews and the notification calls themselves are never listed.
 */
export interface Activity {
  title: string;
  body: string;
  /** app screen the notification opens */
  link: string;
}

type Maker = (body: unknown) => Activity | null;

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

const a =
  (title: string, body: string, link: string): Maker =>
  () => ({ title, body, link });

const FIGURES = 'Orders already calculated keep their figures until you apply the change to them.';

/** "METHOD /path/with/:params" without the /api/v1 prefix. */
const ACTIVITIES: Record<string, Maker> = {
  // costs
  'PUT /settings/costs/:variantId': a(
    'Product cost saved',
    `New orders use it straight away. ${FIGURES}`,
    '/products',
  ),
  'POST /settings/costs/import': (body) =>
    asRecord(body).preview === true
      ? null
      : {
          title: 'Product costs imported',
          body: `The costs in your file were saved. ${FIGURES}`,
          link: '/products',
        },
  'POST /settings/costs/bulk': a(
    'Product costs updated',
    `One cost was set on several variants. ${FIGURES}`,
    '/products',
  ),
  'DELETE /settings/costs/entry/:id': a(
    'Product cost removed',
    'The cost entry was removed from the history of the variant.',
    '/products',
  ),
  // rules
  'POST /settings/fee-rules': a(
    'Payment fee rule added',
    `Orders on that gateway use it as an estimate. ${FIGURES}`,
    '/settings',
  ),
  'DELETE /settings/fee-rules/:id': a('Payment fee rule removed', FIGURES, '/settings'),
  'POST /settings/shipping-rules': a(
    'Shipping cost rule added',
    `Matching orders use it as an estimate. ${FIGURES}`,
    '/shipping',
  ),
  'POST /settings/shipping-rules/import': (body) =>
    asRecord(body).preview === true
      ? null
      : {
          title: 'Shipping cost rules imported',
          body: `The rules in your file were saved. ${FIGURES}`,
          link: '/shipping',
        },
  'DELETE /settings/shipping-rules/:id': a('Shipping cost rule removed', FIGURES, '/shipping'),
  // settings
  'PUT /settings/limits': a(
    'Alert limits saved',
    'The Overview and the Profit screen use the new limits.',
    '/settings',
  ),
  'PUT /settings/alert-emails': a(
    'Alert emails saved',
    'Alerts and reports go to the addresses you set.',
    '/settings',
  ),
  'PUT /settings/expense-defaults': a(
    'Expense defaults saved',
    'A new expense now starts as you chose. Expenses you already added do not change.',
    '/settings',
  ),
  'PUT /settings/threshold': a(
    'Missing-cost warning level saved',
    'The warning on the Overview uses the new level.',
    '/settings',
  ),
  'POST /settings/recalculate': (body) => ({
    title: 'Recalculation started',
    body:
      asRecord(body).mode === 'everything'
        ? 'Every past order is being calculated again. Figures can change.'
        : 'Past orders that had no cost are being priced. Figures update in a minute or two.',
    link: '/settings',
  }),
  // expenses
  'POST /expenses/categories': a(
    'Expense category added',
    'You can pick it when you add an expense.',
    '/expenses',
  ),
  'PUT /expenses/categories/:id': a(
    'Expense category changed',
    'The new name is used everywhere.',
    '/expenses',
  ),
  'DELETE /expenses/categories/:id': a(
    'Expense category removed',
    'Its expenses were kept.',
    '/expenses',
  ),
  'POST /expenses': a(
    'Expense added',
    'It counts in the profit figures for the months it covers.',
    '/expenses',
  ),
  'POST /expenses/:id/change': a(
    'Expense changed',
    'Earlier months keep the amount that applied then.',
    '/expenses',
  ),
  'POST /expenses/:id/stop': a(
    'Expense stopped',
    'It no longer counts after the last day you chose.',
    '/expenses',
  ),
  'DELETE /expenses/:id': a('Expense removed', 'It was removed from every period.', '/expenses'),
  'PUT /expenses/:id/months/:month': a(
    'Expense amount for a month saved',
    'That month uses the new amount.',
    '/expenses',
  ),
  'DELETE /expenses/:id/months/:month': a(
    'Expense amount for a month removed',
    'That month uses the regular amount again.',
    '/expenses',
  ),
  // marketing
  'POST /marketing/connections/:id/accounts': a(
    'Ad accounts connected',
    'Spend is imported daily and shown next to profit.',
    '/marketing',
  ),
  'DELETE /marketing/connections/:id': a(
    'Ad connection cancelled',
    'Nothing was connected.',
    '/marketing',
  ),
  'POST /marketing/accounts': a(
    'Ad account added',
    'You can now enter spend for it.',
    '/marketing',
  ),
  'DELETE /marketing/accounts/:id': a(
    'Ad account removed',
    'Its spend no longer counts.',
    '/marketing',
  ),
  'POST /marketing/accounts/:id/spend': a(
    'Ad spend saved',
    'Saving the same day again replaces it.',
    '/marketing',
  ),
  'POST /marketing/sync': a(
    'Ad spend sync started',
    'New spend appears in a minute or two.',
    '/marketing',
  ),
  // reports
  'POST /reports/exports': a(
    'Report export started',
    'It appears under Downloads when it is ready.',
    '/reports',
  ),
  'POST /reports/exports/:id/retry': a(
    'Report export started again',
    'It appears under Downloads when it is ready.',
    '/reports',
  ),
  'POST /reports/schedules': a(
    'Report schedule added',
    'The first report is sent at the next scheduled time.',
    '/reports',
  ),
  'PATCH /reports/schedules/:id': a(
    'Report schedule changed',
    'The change is used from the next send.',
    '/reports',
  ),
  'DELETE /reports/schedules/:id': a(
    'Report schedule removed',
    'No more emails are sent for it.',
    '/reports',
  ),
  // other
  'POST /billing/cancel': a(
    'Subscription cancelled',
    'You keep the plan until the end of the period you paid for.',
    '/settings',
  ),
  'POST /support': a('Support request sent', 'We will reply to the address you gave.', '/support'),
  'POST /sync': a('Sync started', 'New orders and costs are being read from Shopify.', '/settings'),
};

/** The route as the matcher knows it: no /api/v1 prefix, no query string, no trailing slash. */
export function normalizeRoute(url: string): string {
  const path = url.split('?')[0] ?? url;
  return path.replace(/^\/api\/v1/, '').replace(/\/+$/, '') || '/';
}

/** What to tell the merchant after this call succeeded, or null when it is not a change worth telling about. */
export function describeActivity(
  method: string,
  routePattern: string,
  body: unknown,
): Activity | null {
  const make = ACTIVITIES[`${method.toUpperCase()} ${normalizeRoute(routePattern)}`];
  if (!make) return null;
  return make(body) ?? null;
}

export const ACTIVITY_ROUTES = Object.keys(ACTIVITIES);
