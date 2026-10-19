import {
  getAlertEmailRecipients,
  getShopOverview,
  listActiveShops,
  listAlertsToEmail,
  markAlertsEmailed,
} from '@pi/db';
import type { AlertToEmail, Db } from '@pi/db';
import type { MailSender } from '../reports/mail.js';

type Log = { info(m: string): void; warn(m: string): void };

interface Deps {
  db: Db;
  log: Log;
  mail: MailSender;
  now?: () => Date;
  /** the app's key, to link into the embedded app from the email */
  apiKey: string;
}

/** Alerts older than this are not emailed (turning emails on does not send old news). */
export const EMAIL_WINDOW_HOURS = 48;
const HOUR = 3_600_000;

/** The email for one shop: a short subject, each alert with why it matters, and one link to open. */
export function composeAlertEmail(
  shopName: string,
  alerts: AlertToEmail[],
  appUrl: (path: string | null) => string,
): { subject: string; text: string } {
  const critical = alerts.filter((a) => a.severity === 'critical').length;
  const subject =
    alerts.length === 1
      ? `Profit alert for ${shopName}: ${alerts[0]!.title}`
      : `${alerts.length} profit alerts for ${shopName}${critical > 0 ? ` (${critical} serious)` : ''}`;
  const lines = [
    `Tanvo Profit found ${alerts.length === 1 ? 'something' : `${alerts.length} things`} to look at in ${shopName}.`,
    '',
    ...alerts.flatMap((a) => [
      `${a.severity === 'critical' ? '[Serious] ' : ''}${a.title}`,
      a.body,
      `Open: ${appUrl(a.link)}`,
      '',
    ]),
    'You get this email because alert emails are turned on in Settings, Alerts. To stop it, remove',
    'your address there. Figures can be partial while costs or imports are incomplete.',
  ];
  return { subject, text: lines.join('\n') };
}

/**
 * Emails new warnings and critical findings to the addresses each shop chose (up to five). One email
 * per recipient per run lists everything new, so a busy day is one message, not ten. A message is
 * marked as emailed only after every recipient was reached; if the mail server is down or an address
 * bounces, it stays unmarked and is tried again on the next run until it is older than 48 hours.
 * Shops with no addresses are skipped, and one shop failing never stops the others.
 */
export async function emailAlerts(
  deps: Deps,
): Promise<{ shops: number; emails: number; alerts: number }> {
  const now = (deps.now ?? (() => new Date()))();
  const since = new Date(now.getTime() - EMAIL_WINDOW_HOURS * HOUR);
  let shops = 0;
  let emails = 0;
  let alerts = 0;

  for (const scope of await listActiveShops(deps.db)) {
    try {
      const recipients = await getAlertEmailRecipients(deps.db, scope);
      if (recipients.length === 0) continue;
      const pending = await listAlertsToEmail(deps.db, scope, since);
      if (pending.length === 0) continue;
      const shop = await getShopOverview(deps.db, scope);
      if (!shop) continue;

      const appUrl = (path: string | null) =>
        `https://${shop.shopifyDomain}/admin/apps/${deps.apiKey}${path ?? ''}`;
      const { subject, text } = composeAlertEmail(shop.tenantName, pending, appUrl);

      let reached = 0;
      for (const to of recipients) {
        try {
          await deps.mail.send({ to, subject, text, attachments: [] });
          reached++;
          emails++;
        } catch (e) {
          deps.log.warn(
            `alert email: shop ${scope.shopId} could not reach a recipient (${e instanceof Error ? e.message : 'error'})`,
          );
        }
      }
      if (reached === recipients.length) {
        await markAlertsEmailed(
          deps.db,
          scope,
          pending.map((p) => p.id),
        );
        shops++;
        alerts += pending.length;
      }
    } catch (e) {
      deps.log.warn(
        `alert email: shop ${scope.shopId} failed: ${e instanceof Error ? e.name : 'error'}`,
      );
    }
  }
  deps.log.info(`alert email: ${shops} shop(s), ${emails} email(s), ${alerts} alert(s)`);
  return { shops, emails, alerts };
}
