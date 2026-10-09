import type { HealthResponse } from '@pi/contracts';

export function GET() {
  const body: HealthResponse = { status: 'ok', service: 'web', time: new Date().toISOString() };
  return Response.json(body);
}
