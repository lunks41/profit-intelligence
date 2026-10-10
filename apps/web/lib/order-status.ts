export type StatusTone = 'success' | 'info' | 'caution' | 'critical' | 'neutral';

const KNOWN: Record<string, { label: string; tone: StatusTone }> = {
  PAID: { label: 'Paid', tone: 'success' },
  PARTIALLY_REFUNDED: { label: 'Partially refunded', tone: 'caution' },
  REFUNDED: { label: 'Refunded', tone: 'neutral' },
  PENDING: { label: 'Pending', tone: 'caution' },
  AUTHORIZED: { label: 'Authorized', tone: 'info' },
  PARTIALLY_PAID: { label: 'Partially paid', tone: 'caution' },
  VOIDED: { label: 'Voided', tone: 'neutral' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
};

const FULFILLMENT: Record<string, { label: string; tone: StatusTone }> = {
  FULFILLED: { label: 'Fulfilled', tone: 'success' },
  PARTIALLY_FULFILLED: { label: 'Partially fulfilled', tone: 'caution' },
  UNFULFILLED: { label: 'Unfulfilled', tone: 'caution' },
  IN_PROGRESS: { label: 'In progress', tone: 'info' },
  ON_HOLD: { label: 'On hold', tone: 'caution' },
  SCHEDULED: { label: 'Scheduled', tone: 'info' },
  PENDING_FULFILLMENT: { label: 'Pending', tone: 'info' },
  FULFILLMENT_NOT_REQUIRED: { label: 'Nothing to ship', tone: 'neutral' },
  RESTOCKED: { label: 'Restocked', tone: 'neutral' },
};

/** Shopify's fulfillment status in plain words; none stored is shown as Unknown. */
export function fulfillmentStatus(status: string | null): { label: string; tone: StatusTone } {
  if (!status) return { label: 'Unknown', tone: 'neutral' };
  const known = FULFILLMENT[status.toUpperCase()];
  if (known) return known;
  const words = status.replace(/_/g, ' ').toLowerCase();
  return { label: words.charAt(0).toUpperCase() + words.slice(1), tone: 'neutral' };
}

/** Shopify's payment status as the words a merchant knows; anything new is shown in plain case. */
export function paymentStatus(status: string): { label: string; tone: StatusTone } {
  const known = KNOWN[status.toUpperCase()];
  if (known) return known;
  const words = status.replace(/_/g, ' ').toLowerCase();
  return { label: words.charAt(0).toUpperCase() + words.slice(1), tone: 'neutral' };
}
