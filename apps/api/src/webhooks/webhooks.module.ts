import { Module } from '@nestjs/common';
import { WebhookReceiver } from './webhook-receiver.service.js';
import { WebhooksController } from './webhooks.controller.js';

@Module({ controllers: [WebhooksController], providers: [WebhookReceiver] })
export class WebhooksModule {}
