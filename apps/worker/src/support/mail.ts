import type { SupportMailPayload } from '@pi/db';
import type { MailSender } from '../reports/mail.js';

const KIND_LABEL: Record<SupportMailPayload['kind'], string> = {
  feedback: 'Feedback',
  question: 'Question',
  problem: 'Problem',
};

const BRAND = 'Tanvo Profit';
const ACCENT = '#5b21b6';

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Keeps the merchant's line breaks without trusting any markup in their text. */
const body = (text: string) => esc(text).replace(/\r?\n/g, '<br>');

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function layout(title: string, inner: string, footer: string): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f4f7;font-family:Segoe UI,Arial,sans-serif;color:#1f1f23">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e3e3e8;border-radius:10px;overflow:hidden">
<tr><td style="background:${ACCENT};padding:18px 24px;color:#ffffff;font-size:18px;font-weight:700">${BRAND}<span style="font-weight:400;opacity:.85"> &middot; ${esc(title)}</span></td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.55">${inner}</td></tr>
<tr><td style="padding:14px 24px;background:#fafafb;border-top:1px solid #ececf0;font-size:12px;color:#6b6b76">${footer}</td></tr>
</table></body></html>`;
}

const row = (label: string, value: string) =>
  `<tr><td style="padding:4px 16px 4px 0;color:#6b6b76;white-space:nowrap;vertical-align:top">${label}</td><td style="padding:4px 0">${value}</td></tr>`;

export function supportMessageMail(payload: SupportMailPayload) {
  const label = KIND_LABEL[payload.kind];
  const reply = payload.contactEmail
    ? `<a href="mailto:${esc(payload.contactEmail)}?subject=${encodeURIComponent(`Re: ${BRAND} #${payload.reference}`)}" style="color:${ACCENT}">${esc(payload.contactEmail)}</a>`
    : '<span style="color:#b42318">No address given, so this cannot be answered by email</span>';
  const html = layout(
    `New ${label.toLowerCase()}`,
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:16px">
${row('Reference', `<strong>#${esc(payload.reference)}</strong>`)}
${row('Type', esc(label))}
${row('Store', `<a href="https://${esc(payload.shopDomain)}/admin" style="color:${ACCENT}">${esc(payload.shopDomain)}</a>`)}
${row('Sent', esc(when(payload.sentAt)))}
${row('Reply to', reply)}
</table>
<div style="padding:14px 16px;background:#f7f5fd;border-left:4px solid ${ACCENT};border-radius:4px">${body(payload.message)}</div>`,
    'Press Reply to answer the merchant directly. Do not ask for customer details.',
  );
  const text = [
    `New ${label.toLowerCase()} #${payload.reference}`,
    '',
    `Store:    ${payload.shopDomain}`,
    `Type:     ${label}`,
    `Sent:     ${when(payload.sentAt)}`,
    `Reply to: ${payload.contactEmail ?? 'no address given'}`,
    '',
    payload.message,
  ].join('\n');
  return { subject: `[${label}] #${payload.reference} ${payload.shopDomain}`, html, text };
}

export function merchantReceiptMail(payload: SupportMailPayload) {
  const html = layout(
    'We got your message',
    `<p style="margin:0 0 12px">Hello,</p>
<p style="margin:0 0 16px">Thank you for writing to ${BRAND}. We read every message and will reply to this address.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:16px">
${row('Reference', `<strong>#${esc(payload.reference)}</strong>`)}
${row('Store', esc(payload.shopDomain))}
${row('Sent', esc(when(payload.sentAt)))}
</table>
<p style="margin:0 0 6px;color:#6b6b76">Your message</p>
<div style="padding:14px 16px;background:#f7f5fd;border-left:4px solid ${ACCENT};border-radius:4px">${body(payload.message)}</div>
<p style="margin:16px 0 0">Quote the reference <strong>#${esc(payload.reference)}</strong> if you write to us again about this.</p>`,
    `${BRAND}. Please do not include customer names, emails or addresses when you write to us.`,
  );
  const text = [
    'Hello,',
    '',
    `Thank you for writing to ${BRAND}. We read every message and will reply to this address.`,
    '',
    `Reference: #${payload.reference}`,
    `Store:     ${payload.shopDomain}`,
    '',
    'Your message:',
    payload.message,
    '',
    `Quote the reference #${payload.reference} if you write to us again about this.`,
  ].join('\n');
  return { subject: `We received your message (#${payload.reference})`, html, text };
}

/**
 * Emails a merchant's message to the support address, with the merchant's address as reply-to, and sends the
 * merchant a receipt. An error is thrown on purpose so the queue retries when mail is not set up yet.
 */
export async function sendSupportMail(
  deps: { mail: MailSender; supportEmail: string | undefined },
  payload: SupportMailPayload,
): Promise<void> {
  const { mail, supportEmail } = deps;
  if (!supportEmail) throw new Error('SUPPORT_EMAIL is not set');
  await mail.send({
    to: supportEmail,
    ...(payload.contactEmail ? { replyTo: payload.contactEmail } : {}),
    ...supportMessageMail(payload),
  });
  if (payload.contactEmail) {
    await mail.send({
      to: payload.contactEmail,
      replyTo: supportEmail,
      ...merchantReceiptMail(payload),
    });
  }
}
