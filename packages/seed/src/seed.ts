import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { assignCosts, cents, generatePlan } from './plan.js';
import type { CatalogVariant, PlannedOrder } from './plan.js';
import { sleep } from './shopify.js';
import type { Json, ShopifyClient } from './shopify.js';

export interface SeedOptions {
  orders: number;
  days: number;
  seed: number;
  limit?: number;
  scenarios?: string[];
  stages: Set<'costs' | 'orders' | 'refunds' | 'manifest'>;
  dryRun: boolean;
}

/** Deterministic UUID (v5-style) so retries of the same action reuse the same idempotency key. */
function uuidFrom(text: string): string {
  const h = createHash('sha1').update(text).digest('hex');
  const variant = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

const toCents = (amount: string) => Math.round(parseFloat(amount) * 100);
const EUR_RATE = 0.92;

function bag(c: number, currency: 'USD' | 'EUR') {
  const shopMoney = { amount: cents(c), currencyCode: 'USD' };
  return currency === 'EUR'
    ? {
        shopMoney,
        presentmentMoney: { amount: cents(Math.round(c * EUR_RATE)), currencyCode: 'EUR' },
      }
    : { shopMoney };
}

export async function fetchCatalog(client: ShopifyClient): Promise<CatalogVariant[]> {
  const out: CatalogVariant[] = [];
  let cursor: string | null = null;
  do {
    const data: Json = await client.gql(
      `query($c: String) { products(first: 50, after: $c, query: "status:active") {
         pageInfo { hasNextPage endCursor }
         nodes { id title isGiftCard variants(first: 100) { nodes {
           id title sku price inventoryItem { id unitCost { amount } } } } } } }`,
      { c: cursor },
    );
    for (const p of data.products.nodes) {
      if (p.isGiftCard) continue;
      for (const v of p.variants.nodes) {
        const priceCents = toCents(v.price);
        if (priceCents <= 0) continue;
        out.push({
          id: v.id,
          productId: p.id,
          productTitle: p.title,
          title: v.title,
          sku: v.sku || null,
          priceCents,
          costCents: v.inventoryItem?.unitCost ? toCents(v.inventoryItem.unitCost.amount) : null,
        });
      }
    }
    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (cursor);
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

async function syncCosts(client: ShopifyClient, costed: CatalogVariant[], dryRun: boolean) {
  const current = await fetchCatalog(client);
  const inventoryIds = new Map<string, { inventoryItemId: string; cost: number | null }>();
  let cursor: string | null = null;
  do {
    const data: Json = await client.gql(
      `query($c: String) { productVariants(first: 100, after: $c) {
         pageInfo { hasNextPage endCursor }
         nodes { id inventoryItem { id unitCost { amount } } } } }`,
      { c: cursor },
    );
    for (const v of data.productVariants.nodes) {
      inventoryIds.set(v.id, {
        inventoryItemId: v.inventoryItem.id,
        cost: v.inventoryItem.unitCost ? toCents(v.inventoryItem.unitCost.amount) : null,
      });
    }
    cursor = data.productVariants.pageInfo.hasNextPage
      ? data.productVariants.pageInfo.endCursor
      : null;
  } while (cursor);

  let updated = 0;
  for (const v of costed) {
    const inv = inventoryIds.get(v.id);
    if (!inv || v.costCents === null || inv.cost === v.costCents) continue;
    updated++;
    if (dryRun) continue;
    const res: Json = await client.gql(
      `mutation($id: ID!, $input: InventoryItemInput!) {
         inventoryItemUpdate(id: $id, input: $input) { userErrors { field message } } }`,
      { id: inv.inventoryItemId, input: { cost: cents(v.costCents) } },
    );
    const errs = res.inventoryItemUpdate.userErrors;
    if (errs.length) throw new Error(`Cost update failed: ${JSON.stringify(errs)}`);
  }
  const without = costed.filter((v) => v.costCents === null).length;
  console.log(
    `costs: ${updated} variant(s) ${dryRun ? 'would be ' : ''}updated, ${without} of ${costed.length} left without cost on purpose (${current.length} variants in store)`,
  );
}

function orderInput(o: PlannedOrder) {
  const lineItems = o.lines.map((l) => ({
    variantId: l.variantId,
    quantity: l.quantity,
    priceSet: bag(l.unitPriceCents, o.currency),
    requiresShipping: true,
    taxLines:
      l.taxCents > 0
        ? [{ title: 'Sales tax', rate: o.taxRate / 100, priceSet: bag(l.taxCents, o.currency) }]
        : [],
  }));
  const total = o.expected.totalCents;
  const gateway = 'manual';
  const transactions =
    o.financialStatus === 'PAID' && total > 0
      ? [
          {
            kind: 'SALE',
            status: 'SUCCESS',
            gateway,
            amountSet: bag(total, o.currency),
            processedAt: o.processedAt,
          },
        ]
      : o.financialStatus === 'AUTHORIZED'
        ? [
            {
              kind: 'AUTHORIZATION',
              status: 'SUCCESS',
              gateway,
              amountSet: bag(total, o.currency),
              processedAt: o.processedAt,
            },
          ]
        : o.financialStatus === 'PARTIALLY_PAID'
          ? [
              {
                kind: 'SALE',
                status: 'SUCCESS',
                gateway,
                amountSet: bag(Math.round(total / 2), o.currency),
                processedAt: o.processedAt,
              },
            ]
          : [];

  const discount = o.discount;
  const discountCode =
    discount?.kind === 'percent'
      ? { itemPercentageDiscountCode: { code: discount.code, percentage: discount.percent } }
      : discount?.kind === 'fixed'
        ? {
            itemFixedDiscountCode: {
              code: discount.code,
              amountSet: bag(discount.amountCents, o.currency),
            },
          }
        : discount?.kind === 'free_shipping'
          ? { freeShippingDiscountCode: { code: discount.code } }
          : undefined;

  return {
    currency: 'USD',
    ...(o.currency === 'EUR' ? { presentmentCurrency: 'EUR' } : {}),
    processedAt: o.processedAt,
    sourceIdentifier: o.sourceId,
    sourceName: 'pi-seed',
    taxesIncluded: o.taxesIncluded,
    financialStatus: o.financialStatus,
    lineItems,
    shippingLines:
      o.shippingCents > 0
        ? [
            {
              title: 'Standard shipping',
              code: 'standard',
              priceSet: bag(o.shippingCents, o.currency),
            },
          ]
        : [],
    ...(discountCode ? { discountCode } : {}),
    ...(o.customer ? { email: o.customer.email, customer: { toUpsert: { ...o.customer } } } : {}),
    transactions,
    tags: ['pi-seed', ...o.scenarios.map((s) => `pi-${s}`), ...o.modifiers.map((m) => `pi-${m}`)],
    note: `Seeded test order ${o.sourceId}`,
  };
}

const ORDER_FIELDS = `id name sourceIdentifier processedAt cancelledAt displayFinancialStatus taxesIncluded
  subtotalPriceSet { shopMoney { amount } } totalDiscountsSet { shopMoney { amount } }
  totalShippingPriceSet { shopMoney { amount } } totalTaxSet { shopMoney { amount } }
  totalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
  totalRefundedSet { shopMoney { amount } }
  lineItems(first: 20) { nodes { id quantity } }
  refunds { id createdAt totalRefundedSet { shopMoney { amount } } }`;

async function existingOrders(client: ShopifyClient): Promise<Map<string, Json>> {
  const map = new Map<string, Json>();
  let cursor: string | null = null;
  do {
    const data: Json = await client.gql(
      `query($c: String) { orders(first: 50, after: $c, query: "tag:pi-seed") {
         pageInfo { hasNextPage endCursor } nodes { ${ORDER_FIELDS} } } }`,
      { c: cursor },
    );
    for (const o of data.orders.nodes) if (o.sourceIdentifier) map.set(o.sourceIdentifier, o);
    cursor = data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor : null;
  } while (cursor);
  return map;
}

async function createOrder(client: ShopifyClient, o: PlannedOrder): Promise<Json | null> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const data: Json = await client.gql(
      `mutation($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
         orderCreate(order: $order, options: $options) {
           order { ${ORDER_FIELDS} } userErrors { field message } } }`,
      {
        order: orderInput(o),
        options: {
          inventoryBehaviour: 'BYPASS',
          sendReceipt: false,
          sendFulfillmentReceipt: false,
        },
      },
    );
    const { order, userErrors } = data.orderCreate;
    if (order) return order;
    const text = JSON.stringify(userErrors);
    if (/limit|too many|exceed/i.test(text)) {
      console.log(`  rate limited by Shopify, waiting 60s (${text.slice(0, 120)})`);
      await sleep(60_000);
      continue;
    }
    console.log(`  order ${o.index} (${o.scenarios[0]}) rejected: ${text}`);
    return null;
  }
  return null;
}

async function firstLocation(client: ShopifyClient): Promise<string | null> {
  try {
    const data: Json = await client.gql('{ locations(first: 1) { nodes { id } } }');
    return data.locations.nodes[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function refundOrder(
  client: ShopifyClient,
  o: PlannedOrder,
  shopOrder: Json,
  locationId: string | null,
): Promise<boolean> {
  const refund = o.refund!;
  const restockType = refund.restock && locationId ? 'RETURN' : 'NO_RESTOCK';
  const lineNodes: Json[] = shopOrder.lineItems.nodes;
  const items =
    refund.kind === 'partial'
      ? [
          {
            lineItemId: lineNodes[refund.lineIndex]!.id,
            quantity: refund.quantity,
            restockType,
            ...(restockType === 'RETURN' ? { locationId } : {}),
          },
        ]
      : refund.kind === 'full'
        ? lineNodes.map((l) => ({
            lineItemId: l.id,
            quantity: l.quantity,
            restockType,
            ...(restockType === 'RETURN' ? { locationId } : {}),
          }))
        : [];
  const refundShipping = refund.kind !== 'partial';

  const sug: Json = await client.gql(
    `query($id: ID!, $items: [RefundLineItemInput!], $ship: Boolean) {
       order(id: $id) { suggestedRefund(refundLineItems: $items, refundShipping: $ship) {
         amountSet { shopMoney { amount } }
         suggestedTransactions { gateway kind amountSet { shopMoney { amount } } parentTransaction { id } } } } }`,
    { id: shopOrder.id, items, ship: refundShipping },
  );
  const s = sug.order.suggestedRefund;
  const refundAt = new Date(
    new Date(o.processedAt).getTime() + refund.daysAfter * 86_400_000 + 3_600_000,
  );
  const res: Json = await client.gql(
    `mutation($input: RefundInput!, $key: String!) {
       refundCreate(input: $input) @idempotent(key: $key) { refund { id createdAt totalRefundedSet { shopMoney { amount } } }
         userErrors { field message } } }`,
    {
      input: {
        orderId: shopOrder.id,
        notify: false,
        note: `Seeded refund (${refund.kind})`,
        processedAt: refundAt.toISOString(),
        refundLineItems: items,
        ...(refundShipping ? { shipping: { fullRefund: true } } : {}),
        transactions: s.suggestedTransactions.map((t: Json) => ({
          orderId: shopOrder.id,
          gateway: t.gateway,
          kind: 'REFUND',
          amount: t.amountSet.shopMoney.amount,
          parentId: t.parentTransaction?.id,
        })),
      },
      key: uuidFrom(`${o.sourceId}:refund`),
    },
  );
  const errs = res.refundCreate.userErrors;
  if (errs.length) {
    console.log(
      `  refund for order ${o.index} (${o.scenarios[0]}) rejected: ${JSON.stringify(errs)}`,
    );
    return false;
  }
  return true;
}

async function cancelOrder(
  client: ShopifyClient,
  shopOrder: Json,
  o: PlannedOrder,
): Promise<boolean> {
  const res: Json = await client.gql(
    `mutation($id: ID!) {
       orderCancel(orderId: $id, restock: false, reason: OTHER, notifyCustomer: false,
                   staffNote: "Seeded cancellation") {
         job { id } orderCancelUserErrors { field message } } }`,
    { id: shopOrder.id },
  );
  const errs = res.orderCancel.orderCancelUserErrors;
  if (errs.length) {
    console.log(
      `  cancel for order ${o.index} (${o.scenarios[0]}) rejected: ${JSON.stringify(errs)}`,
    );
    return false;
  }
  return true;
}

export async function runSeed(client: ShopifyClient, opts: SeedOptions): Promise<void> {
  const stages = opts.stages;
  const catalog = await fetchCatalog(client);
  if (catalog.length === 0) throw new Error('No active products with prices found in the store');
  const costed = assignCosts(catalog, opts.seed);
  console.log(
    `catalog: ${catalog.length} variants across ${new Set(catalog.map((v) => v.productId)).size} products`,
  );

  if (stages.has('costs')) await syncCosts(client, costed, opts.dryRun);

  let plan = generatePlan({
    seed: opts.seed,
    orders: opts.orders,
    days: opts.days,
    now: new Date(),
    catalog: costed,
  });
  if (opts.scenarios) plan = plan.filter((o) => opts.scenarios!.includes(o.scenarios[0]!));
  if (opts.limit) plan = plan.slice(0, opts.limit);
  console.log(`plan: ${plan.length} order(s)`);

  if (stages.has('orders') || stages.has('refunds')) {
    const existing = await existingOrders(client);
    console.log(`existing seeded orders in store: ${existing.size}`);
    const locationId = await firstLocation(client);
    let created = 0;
    let skipped = 0;
    let failed = 0;
    let refunded = 0;
    let cancelled = 0;

    for (const o of plan) {
      let shopOrder = existing.get(o.sourceId);
      if (!shopOrder && stages.has('orders')) {
        if (opts.dryRun) {
          console.log(
            `  [dry-run] would create #${o.index} ${o.scenarios[0]} ${o.processedAt.slice(0, 10)} total ${cents(o.expected.totalCents)}`,
          );
          continue;
        }
        shopOrder = await createOrder(client, o);
        if (!shopOrder) {
          failed++;
          continue;
        }
        created++;
        if (created % 10 === 0) console.log(`  created ${created} order(s)...`);
      } else if (shopOrder) skipped++;
      if (!shopOrder || !stages.has('refunds') || opts.dryRun) continue;

      if (o.refund && shopOrder.refunds.length === 0) {
        if (await refundOrder(client, o, shopOrder, locationId)) refunded++;
      }
      if (o.cancel && !shopOrder.cancelledAt) {
        if (await cancelOrder(client, shopOrder, o)) cancelled++;
      }
    }
    console.log(
      `orders: created ${created}, already present ${skipped}, failed ${failed}; refunds ${refunded}; cancellations ${cancelled}`,
    );
  }

  if (stages.has('manifest') && !opts.dryRun) {
    await sleep(3000); // let async cancellations settle
    const seeded = [...(await existingOrders(client)).values()];
    const planBySource = new Map(
      generatePlan({
        seed: opts.seed,
        orders: opts.orders,
        days: opts.days,
        now: new Date(),
        catalog: costed,
      }).map((p) => [p.sourceId, p]),
    );
    const rows = seeded.map((s) => {
      const p = planBySource.get(s.sourceIdentifier);
      const m = (x: Json) => toCents(x.shopMoney.amount);
      return {
        shopifyId: s.id,
        name: s.name,
        sourceId: s.sourceIdentifier,
        scenario: p?.scenarios[0] ?? null,
        modifiers: p?.modifiers ?? [],
        processedAt: s.processedAt,
        status: s.displayFinancialStatus,
        cancelled: Boolean(s.cancelledAt),
        taxesIncluded: s.taxesIncluded,
        currency: s.totalPriceSet.shopMoney.currencyCode,
        presentmentCurrency: s.totalPriceSet.presentmentMoney?.currencyCode ?? null,
        subtotalCents: m(s.subtotalPriceSet),
        discountCents: m(s.totalDiscountsSet),
        shippingCents: m(s.totalShippingPriceSet),
        taxCents: m(s.totalTaxSet),
        totalCents: m(s.totalPriceSet),
        refundedCents: m(s.totalRefundedSet),
        refunds: s.refunds.map((r: Json) => ({
          id: r.id,
          createdAt: r.createdAt,
          amountCents: m(r.totalRefundedSet),
        })),
        plannedTotalCents: p?.expected.totalCents ?? null,
      };
    });
    const byMonth: Record<string, Record<string, number>> = {};
    for (const r of rows) {
      const k = r.processedAt.slice(0, 7);
      const b = (byMonth[k] ??= {
        orders: 0,
        grossCents: 0,
        discountCents: 0,
        shippingCents: 0,
        taxCents: 0,
        totalCents: 0,
        refundedCents: 0,
        cancelled: 0,
      });
      b.orders! += 1;
      b.grossCents! += r.subtotalCents + r.discountCents;
      b.discountCents! += r.discountCents;
      b.shippingCents! += r.shippingCents;
      b.taxCents! += r.taxCents;
      b.totalCents! += r.totalCents;
      b.refundedCents! += r.refundedCents;
      b.cancelled! += r.cancelled ? 1 : 0;
    }
    const mismatched = rows.filter(
      (r) => r.plannedTotalCents !== null && r.plannedTotalCents !== r.totalCents,
    );
    await mkdir('out', { recursive: true });
    await writeFile(
      'out/manifest.json',
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          seed: opts.seed,
          shop: client.shopDomain,
          variants: costed.map((v) => ({
            id: v.id,
            sku: v.sku,
            priceCents: v.priceCents,
            costCents: v.costCents,
          })),
          summaryByMonth: byMonth,
          totalsMismatchedVsPlan: mismatched.map((r) => ({
            name: r.name,
            scenario: r.scenario,
            planned: r.plannedTotalCents,
            actual: r.totalCents,
          })),
          orders: rows,
        },
        null,
        2,
      ),
    );
    console.log(
      `manifest: ${rows.length} order(s) written to packages/seed/out/manifest.json; ${mismatched.length} total(s) differ from the generator's plan`,
    );
  }
}
