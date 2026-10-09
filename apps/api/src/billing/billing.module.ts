import { Global, Module } from '@nestjs/common';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { EntitlementsService } from './entitlements.service.js';

/** Global: every module that has a limit asks EntitlementsService, never the plan table directly. */
@Global()
@Module({
  controllers: [BillingController],
  providers: [BillingService, EntitlementsService],
  exports: [EntitlementsService],
})
export class BillingModule {}
