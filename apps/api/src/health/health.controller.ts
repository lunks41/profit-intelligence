import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@pi/contracts';

@Controller('health')
export class HealthController {
  @Get()
  check(): HealthResponse {
    return { status: 'ok', service: 'api', time: new Date().toISOString() };
  }
}
