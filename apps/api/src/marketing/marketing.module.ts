import { Module } from '@nestjs/common';
import { AD_HTTP } from '../tokens.js';
import { MarketingController, MarketingOauthController } from './marketing.controller.js';
import { MarketingService } from './marketing.service.js';

@Module({
  controllers: [MarketingController, MarketingOauthController],
  providers: [
    MarketingService,
    { provide: AD_HTTP, useValue: (...a: Parameters<typeof fetch>) => fetch(...a) },
  ],
})
export class MarketingModule {}
