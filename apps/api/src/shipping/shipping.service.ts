import { createHash } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CarrierInvoiceImportBody,
  CarrierInvoiceListResponse,
  CarrierInvoiceResult,
} from '@pi/contracts';
import {
  carrierCoverage,
  carrierFileImported,
  enqueueProfitRecalc,
  listCarrierInvoices,
  matchOrdersByReference,
  normalizeReference,
  revokeCarrierInvoice,
  saveCarrierInvoice,
} from '@pi/db';
import type { Db } from '@pi/db';
import type { PgBoss } from 'pg-boss';
import type { TenantContext } from '../auth/installation.service.js';
import { DB, QUEUE } from '../tokens.js';
import { parseCarrierCsv } from './carrier-csv.js';

const actorOf = (t: TenantContext) => (t.userId ? `shopify-user:${t.userId}` : 'merchant');

/**
 * Carrier invoices: the merchant imports the invoice file of DHL, UPS, FedEx, Amazon Shipping or another carrier, the
 * rows are matched to orders by the order number on the label, and what the carrier charged becomes the actual
 * shipping cost of those orders, replacing the estimate of a rule. Profit for those orders is calculated again.
 */
@Injectable()
export class ShippingService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(QUEUE) private readonly boss: PgBoss,
  ) {}

  async list(scope: TenantContext): Promise<CarrierInvoiceListResponse> {
    const [rows, cover] = await Promise.all([
      listCarrierInvoices(this.db, scope),
      carrierCoverage(this.db, scope),
    ]);
    return { rows, coveredOrders: cover.orders };
  }

  async importInvoice(
    scope: TenantContext,
    body: CarrierInvoiceImportBody,
  ): Promise<CarrierInvoiceResult> {
    const parsed = parseCarrierCsv(body.csv, body.carrier, body.mapping ?? {});
    const columns = { headers: parsed.headers, ...parsed.used };
    const empty = {
      preview: body.preview === true,
      invoiceId: null,
      alreadyImported: false,
      matchedOrders: 0,
      unmatchedRows: parsed.blankReference,
      invalid: parsed.errors.length,
      rows: parsed.rows.length,
      totalAmount: '0.0000',
      messages: parsed.errors.slice(0, 200),
      columns,
    };
    if (!parsed.used.order || !parsed.used.amount) {
      if (body.preview) return empty;
      throw new BadRequestException({ code: 'invalid_input', message: parsed.errors.join(' ') });
    }

    const found = await matchOrdersByReference(
      this.db,
      scope,
      parsed.rows.map((r) => r.reference),
    );
    const matched = parsed.rows.flatMap((r) => {
      const o = found.get(normalizeReference(r.reference));
      return o ? [{ row: r, order: o }] : [];
    });
    const unmatched = parsed.rows.filter((r) => !found.has(normalizeReference(r.reference)));
    const orderIds = new Set(matched.map((m) => m.order.orderId));
    const total = matched.reduce((t, m) => t + Math.round(Number(m.row.amount) * 10000), 0) / 10000;
    const fileHash = createHash('sha256').update(`${body.carrier}\n${body.csv}`).digest('hex');
    const alreadyImported = await carrierFileImported(this.db, scope, fileHash);
    const messages = [
      ...parsed.errors,
      ...(alreadyImported ? ['This file is already imported.'] : []),
      ...(parsed.blankReference > 0
        ? [`${parsed.blankReference} row(s) have no order number and cannot be matched.`]
        : []),
      ...(unmatched.length > 0
        ? [
            `No order of this shop has the number ${unmatched
              .slice(0, 5)
              .map((u) => u.reference)
              .join(', ')}${unmatched.length > 5 ? ` and ${unmatched.length - 5} more` : ''}.`,
          ]
        : []),
    ].slice(0, 200);
    const result: CarrierInvoiceResult = {
      preview: body.preview === true,
      invoiceId: null,
      alreadyImported,
      matchedOrders: orderIds.size,
      unmatchedRows: unmatched.length + parsed.blankReference,
      invalid: parsed.errors.length,
      rows: parsed.rows.length,
      totalAmount: total.toFixed(4),
      messages,
      columns,
    };
    if (body.preview) return result;

    if (parsed.errors.length) {
      throw new BadRequestException({
        code: 'invalid_input',
        message: parsed.errors.slice(0, 8).join('; '),
      });
    }
    if (alreadyImported) {
      throw new BadRequestException({
        code: 'already_imported',
        message: 'This file is already imported.',
      });
    }
    if (matched.length === 0) {
      throw new BadRequestException({
        code: 'nothing_matched',
        message:
          'No row matches an order of this shop. Check the column that holds the order number.',
      });
    }
    const saved = await saveCarrierInvoice(this.db, scope, {
      carrier: body.carrier,
      fileName: body.fileName ?? null,
      fileHash,
      rowCount: parsed.rows.length + parsed.blankReference,
      unmatchedRows: unmatched.length + parsed.blankReference,
      charges: matched.map((m) => ({
        orderId: m.order.orderId,
        reference: m.row.reference,
        amount: m.row.amount,
        chargeDate: m.row.date,
      })),
      actor: actorOf(scope),
    });
    await this.recalculate(scope, [...new Set(matched.map((m) => m.order.orderShopifyId))]);
    return { ...result, invoiceId: saved.id };
  }

  async revoke(scope: TenantContext, id: string) {
    const orders = await revokeCarrierInvoice(this.db, scope, id, actorOf(scope));
    if (orders === null) {
      throw new NotFoundException({ code: 'invoice_not_found', message: 'Invoice not found' });
    }
    await this.recalculate(scope, orders);
    return { revoked: true, orders: orders.length };
  }

  /** Profit of these orders is worked out again, so the shipping cost follows the invoices that stand. */
  private async recalculate(scope: TenantContext, orderShopifyIds: number[]) {
    for (let i = 0; i < orderShopifyIds.length; i += 500) {
      await enqueueProfitRecalc(this.boss, {
        tenantId: scope.tenantId,
        shopId: scope.shopId,
        orderShopifyIds: orderShopifyIds.slice(i, i + 500),
        force: false,
        requestedBy: 'merchant',
      });
    }
  }
}
