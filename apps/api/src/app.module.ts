import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from './auth/auth.module.js';
import { ConfigModule } from './config/config.module.js';
import { ApiErrorFilter } from './common/error.filter.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { DbModule } from './db/db.module.js';
import { HealthController } from './health/health.controller.js';
import { ProfitabilityModule } from './profitability/profitability.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { ExpensesModule } from './expenses/expenses.module.js';
import { MarketingModule } from './marketing/marketing.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { LeakageModule } from './leakage/leakage.module.js';
import { BillingModule } from './billing/billing.module.js';
import { SupportModule } from './support/support.module.js';
import { QueueModule } from './queue/queue.module.js';
import { SyncModule } from './sync/sync.module.js';
import { SessionController } from './session/session.controller.js';
import { ShopifyModule } from './shopify/shopify.module.js';
import { WebhooksModule } from './webhooks/webhooks.module.js';

@Module({
  imports: [
    ConfigModule,
    DbModule,
    QueueModule,
    ShopifyModule,
    SyncModule,
    AuthModule,
    WebhooksModule,
    DashboardModule,
    ProfitabilityModule,
    SettingsModule,
    ExpensesModule,
    MarketingModule,
    ReportsModule,
    LeakageModule,
    BillingModule,
    SupportModule,
  ],
  controllers: [HealthController, SessionController],
  providers: [{ provide: APP_FILTER, useClass: ApiErrorFilter }],
})
export class AppModule {}
