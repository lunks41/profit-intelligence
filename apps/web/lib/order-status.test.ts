import { describe, expect, it } from 'vitest';
import { paymentStatus } from './order-status';

describe('payment status words', () => {
  it.each([
    ['PAID', 'Paid', 'success'],
    ['PARTIALLY_REFUNDED', 'Partially refunded', 'caution'],
    ['REFUNDED', 'Refunded', 'neutral'],
    ['PENDING', 'Pending', 'caution'],
    ['pending', 'Pending', 'caution'],
    ['VOIDED', 'Voided', 'neutral'],
  ])('%s is %s', (status, label, tone) => {
    expect(paymentStatus(status)).toEqual({ label, tone });
  });

  it('shows a status it does not know in plain case, neutral', () => {
    expect(paymentStatus('SOMETHING_NEW')).toEqual({ label: 'Something new', tone: 'neutral' });
  });
});
