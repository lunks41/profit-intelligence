import { Module } from '@nestjs/common';
import { LeakageController } from './leakage.controller.js';
import { LeakageService } from './leakage.service.js';

@Module({ controllers: [LeakageController], providers: [LeakageService] })
export class LeakageModule {}
