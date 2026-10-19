// A worker that handles only the support-mail queue. For testing on a PC that shares the live database:
// it cannot pick up the live shops' imports, reports or alerts, because it never subscribes to those queues.
//   pnpm --filter @pi/worker dev:support
import { SUPPORT_MAIL_QUEUE, startQueue } from '@pi/db';
import type { SupportMailPayload } from '@pi/db';
import { createLogger } from '@pi/config';
import { createMailSender } from './reports/mail.js';
import { sendSupportMail } from './support/mail.js';

const log = createLogger('worker-support');
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set');

const boss = await startQueue(databaseUrl);
const mail = createMailSender(process.env);
await boss.work<SupportMailPayload>(SUPPORT_MAIL_QUEUE, { batchSize: 1 }, async ([job]) => {
  if (!job) return;
  try {
    await sendSupportMail(
      { mail, supportEmail: process.env.SUPPORT_EMAIL ?? process.env.NEXT_PUBLIC_SUPPORT_EMAIL },
      job.data,
    );
  } catch (e) {
    log.error(`support mail failed: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }
  log.info(`support mail sent for ${job.data.shopDomain}`);
});
log.info('processing support mail only');
