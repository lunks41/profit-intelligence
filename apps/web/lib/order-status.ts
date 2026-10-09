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

/** Shopify's payment status as the words a merchant knows; anything new is shown in plain case. */
export function paymentStatus(status: string): { label: string; tone: StatusTone } {
  const known = KNOWN[status.toUpperCase()];
  if (known) return known;
  const words = status.replace(/_/g, ' ').toLowerCase();
  return { label: words.charAt(0).toUpperCase() + words.slice(1), tone: 'neutral' };
}
