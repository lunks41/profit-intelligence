import { Module } from '@nestjs/common';
import { MarketingController } from './marketing.controller.js';
import { MarketingService } from './marketing.service.js';

@Module({ controllers: [MarketingController], providers: [MarketingService] })
export class MarketingModule {}
