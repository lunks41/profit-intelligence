import { inflateRawSync } from 'node:zlib';
import type { SpendInput } from '@pi/db';

const fail = (name: string, msg: string) => {
  const err = new Error(msg);
  err.name = name;
  return err;
};

const NS = 'https://bingads.microsoft.com/Reporting/v13';
const URL_REPORTING =
  'https://reporting.api.bingads.microsoft.com/Api/Advertiser/Reporting/v13/ReportingService.svc';

/** First file of a zip archive. The reports Microsoft sends hold one CSV. */
export function unzipFirst(buf: Buffer): string {
  if (buf.length < 30 || buf.readUInt32LE(0) !== 0x04034b50) {
    throw fail('MicrosoftRejected', 'Microsoft report was not a zip file');
  }
  const method = buf.readUInt16LE(8);
  const nameLength = buf.readUInt16LE(26);
  const extraLength = buf.readUInt16LE(28);
  const data = buf.subarray(30 + nameLength + extraLength);
  const raw = method === 0 ? data : inflateRawSync(data);
  return raw.toString('utf8').replace(new RegExp('^' + String.fromCharCode(0xfeff)), '');
}

/** One CSV line into fields, with quoted fields and doubled quotes. */
function csvFields(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** A day in the report, either 2026-10-12 or 10/12/2026. */
function isoOf(v: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v);
  if (us) return `${us[3]}-${us[1]!.padStart(2, '0')}-${us[2]!.padStart(2, '0')}`;
  return null;
}

/**
 * Maps the daily campaign report CSV: TimePeriod, CampaignName, Spend, Impressions, Clicks. Lines before the header
 * and after the rows (a copyright line) are skipped. Reported sales stay empty. Written from the documentation:
 * Microsoft Advertising reporting is the part most likely to need a fix on the first real account.
 */
export function mapMicrosoftReport(csv: string): SpendInput[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== '');
  const headerAt = lines.findIndex((l) => /(^|,)"?TimePeriod"?(,|$)/.test(l));
  if (headerAt < 0) throw fail('MicrosoftRejected', 'Microsoft report had no header row');
  const header = csvFields(lines[headerAt]!);
  const col = (name: string) => header.indexOf(name);
  const [t, c, s, im, cl] = ['TimePeriod', 'CampaignName', 'Spend', 'Impressions', 'Clicks'].map(
    col,
  );
  if (t! < 0 || s! < 0)
    throw fail('MicrosoftRejected', 'Microsoft report lacked the spend columns');
  const rows: SpendInput[] = [];
  for (const line of lines.slice(headerAt + 1)) {
    const f = csvFields(line);
    const date = isoOf(f[t!] ?? '');
    const spend = Number((f[s!] ?? '').replace(/,/g, ''));
    if (!date || !Number.isFinite(spend) || spend < 0) continue;
    const num = (i: number | undefined) => {
      const v = i === undefined || i < 0 ? '' : (f[i] ?? '').replace(/,/g, '');
      return v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
    };
    rows.push({
      spendDate: date,
      campaign: (c! >= 0 ? (f[c!] ?? '') : '').slice(0, 120),
      spend: spend.toFixed(4),
      reportedSales: null,
      clicks: num(cl),
      impressions: num(im),
    });
  }
  return rows;
}

const envelope = (
  action: string,
  token: string,
  devToken: string,
  customer: string,
  account: string,
  body: string,
) => {
  const clean = (v: string) => v.replace(/[<>&"']/g, '');
  return (
    `<s:Envelope xmlns:i="http://www.w3.org/2001/XMLSchema-instance" xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<s:Header xmlns="${NS}"><Action mustUnderstand="1">${action}</Action>` +
    `<AuthenticationToken>${clean(token)}</AuthenticationToken>` +
    `<CustomerAccountId>${clean(account)}</CustomerAccountId><CustomerId>${clean(customer)}</CustomerId>` +
    `<DeveloperToken>${clean(devToken)}</DeveloperToken></s:Header><s:Body>${body}</s:Body></s:Envelope>`
  );
};

const day = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `<Day>${d}</Day><Month>${m}</Month><Year>${y}</Year>`;
};

const tag = (xml: string, name: string) =>
  new RegExp(`<(?:\\w+:)?${name}[^>]*>([^<]*)</(?:\\w+:)?${name}>`).exec(xml)?.[1] ?? null;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Daily campaign spend for one Microsoft Advertising account (its id here is "customerId:accountId"). The report is
 * asked for, polled until ready (up to about a minute), downloaded as a zip and read.
 */
export async function fetchMicrosoftDaily(
  externalId: string,
  token: string,
  developerToken: string,
  range: { from: string; to: string },
  fetchImpl: typeof fetch = fetch,
  pollMs = 5000,
): Promise<SpendInput[]> {
  const ids = /^(\d{1,20}):(\d{1,20})$/.exec(externalId);
  if (!ids) throw fail('MicrosoftAccountId', 'Microsoft Advertising account id is not valid');
  if (!developerToken)
    throw fail('MicrosoftNotConfigured', 'Microsoft Advertising is not configured');
  const [, customer, account] = ids as unknown as [string, string, string];
  const call = async (action: string, body: string) => {
    const res = await fetchImpl(URL_REPORTING, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: action },
      body: envelope(action, token, developerToken, customer, account, body),
    });
    if (!res.ok) throw fail('MicrosoftRejected', 'Microsoft rejected the report request');
    return res.text();
  };
  const columns = ['TimePeriod', 'CampaignName', 'Spend', 'Impressions', 'Clicks']
    .map((c) => `<CampaignPerformanceReportColumn>${c}</CampaignPerformanceReportColumn>`)
    .join('');
  const submitted = await call(
    'SubmitGenerateReport',
    `<SubmitGenerateReportRequest xmlns="${NS}"><ReportRequest i:type="CampaignPerformanceReportRequest">` +
      `<ExcludeColumnHeaders>false</ExcludeColumnHeaders><ExcludeReportFooter>true</ExcludeReportFooter>` +
      `<ExcludeReportHeader>true</ExcludeReportHeader><Format>Csv</Format><FormatVersion i:nil="true"/>` +
      `<ReportName>spend</ReportName><ReturnOnlyCompleteData>false</ReturnOnlyCompleteData>` +
      `<Aggregation>Daily</Aggregation><Columns>${columns}</Columns>` +
      `<Scope><AccountIds xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays"><a:long>${account}</a:long></AccountIds></Scope>` +
      `<Time><CustomDateRangeEnd>${day(range.to)}</CustomDateRangeEnd><CustomDateRangeStart>${day(range.from)}</CustomDateRangeStart></Time>` +
      `</ReportRequest></SubmitGenerateReportRequest>`,
  );
  const requestId = tag(submitted, 'ReportRequestId');
  if (!requestId || !/^[\w-]{1,100}$/.test(requestId)) {
    throw fail('MicrosoftRejected', 'Microsoft sent no report request id');
  }
  for (let i = 0; i < 12; i++) {
    const polled = await call(
      'PollGenerateReport',
      `<PollGenerateReportRequest xmlns="${NS}"><ReportRequestId>${requestId}</ReportRequestId></PollGenerateReportRequest>`,
    );
    const status = tag(polled, 'Status');
    if (status === 'Error') throw fail('MicrosoftRejected', 'Microsoft could not build the report');
    if (status === 'Success') {
      const url = tag(polled, 'ReportDownloadUrl')?.replace(/&amp;/g, '&');
      // no report is built when there was no spend: that is an empty report, not an error
      if (!url) return [];
      if (!/^https:\/\//.test(url))
        throw fail('MicrosoftRejected', 'Microsoft sent a download address that is not https');
      const file = await fetchImpl(url);
      if (!file.ok) throw fail('MicrosoftRejected', 'Microsoft report could not be downloaded');
      return mapMicrosoftReport(unzipFirst(Buffer.from(await file.arrayBuffer())));
    }
    await wait(pollMs);
  }
  throw fail('MicrosoftRejected', 'Microsoft report was not ready in time');
}
