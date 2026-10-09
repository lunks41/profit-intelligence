import nodemailer from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  attachments: Array<{ filename: string; content: Buffer; contentType: string }>;
}

export interface MailSender {
  send(mail: Mail): Promise<void>;
}

/** Thrown when no mail server is configured: the delivery is marked failed and can be retried later. */
export class MailNotConfigured extends Error {
  constructor() {
    super('Email sending is not set up on this server');
  }
}

/**
 * SMTP sender, or one that refuses when SMTP_URL is not set. Nothing is silently dropped: a refusal
 * becomes a failed delivery the merchant can see and retry.
 */
export function createMailSender(env: { SMTP_URL?: string; MAIL_FROM?: string }): MailSender {
  if (!env.SMTP_URL) {
    return {
      async send() {
        throw new MailNotConfigured();
      },
    };
  }
  const transport = nodemailer.createTransport(env.SMTP_URL);
  const from = env.MAIL_FROM ?? 'Profit Intelligence <no-reply@localhost>';
  return {
    async send(mail) {
      await transport.sendMail({
        from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        attachments: mail.attachments,
      });
    },
  };
}
