import { describe, expect, it } from 'vitest';
import type { Mail } from '../reports/mail.js';
import { sendSupportMail } from './mail.js';

function recorder() {
  const sent: Mail[] = [];
  return { sent, mail: { send: async (m: Mail) => void sent.push(m) } };
}

const base = {
  reference: 'A1B2C3D4',
  shopDomain: 'a.myshopify.com',
  sentAt: '2026-10-15T10:00:00.000Z',
};

describe('sendSupportMail', () => {
  it('mails support with the merchant as reply-to and sends a receipt', async () => {
    const { sent, mail } = recorder();
    await sendSupportMail(
      { mail, supportEmail: 'support@example.com' },
      { ...base, kind: 'problem', message: 'Costs look wrong', contactEmail: 'm@x.com' },
    );
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ to: 'support@example.com', replyTo: 'm@x.com' });
    expect(sent[0]?.subject).toContain('#A1B2C3D4');
    expect(sent[0]?.subject).toContain('a.myshopify.com');
    expect(sent[0]?.html).toContain('Costs look wrong');
    expect(sent[1]).toMatchObject({ to: 'm@x.com', replyTo: 'support@example.com' });
    expect(sent[1]?.text).toContain('#A1B2C3D4');
  });

  it('escapes markup in the merchant message', async () => {
    const { sent, mail } = recorder();
    await sendSupportMail(
      { mail, supportEmail: 'support@example.com' },
      {
        ...base,
        kind: 'feedback',
        message: '<script>alert(1)</script>\nline two',
        contactEmail: null,
      },
    );
    expect(sent[0]?.html).not.toContain('<script>');
    expect(sent[0]?.html).toContain('&lt;script&gt;');
    expect(sent[0]?.html).toContain('<br>');
  });

  it('sends no receipt without a merchant address', async () => {
    const { sent, mail } = recorder();
    await sendSupportMail(
      { mail, supportEmail: 'support@example.com' },
      { ...base, kind: 'feedback', message: 'Nice app', contactEmail: null },
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]?.replyTo).toBeUndefined();
  });

  it('fails when no support address is configured so the job retries', async () => {
    const { mail } = recorder();
    await expect(
      sendSupportMail(
        { mail, supportEmail: undefined },
        { ...base, kind: 'question', message: 'hello', contactEmail: null },
      ),
    ).rejects.toThrow();
  });
});
