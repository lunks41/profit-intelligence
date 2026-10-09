import { Module } from '@nestjs/common';
import { ProfitabilityController } from './profitability.controller.js';
import { ProfitabilityService } from './profitability.service.js';

@Module({ controllers: [ProfitabilityController], providers: [ProfitabilityService] })
export class ProfitabilityModule {}
