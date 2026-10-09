import { Catch, HttpException, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { ApiError } from '@pi/contracts';
import type { FastifyReply } from 'fastify';

/** One error shape for every failure: { error: { code, message } }. Never leaks internals. */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<FastifyReply>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const obj = typeof res === 'object' ? (res as Record<string, unknown>) : {};
      const body: ApiError = {
        error: {
          code: typeof obj.code === 'string' ? obj.code : `http_${status}`,
          message:
            typeof obj.message === 'string'
              ? obj.message
              : typeof res === 'string'
                ? res
                : exception.message,
        },
      };
      void reply.status(status).send(body);
      return;
    }

    // Only the error class is logged; messages may contain sensitive values.
    this.logger.error(
      `Unhandled error: ${exception instanceof Error ? exception.name : 'unknown'}`,
    );
    const body: ApiError = { error: { code: 'internal_error', message: 'Internal server error' } };
    void reply.status(500).send(body);
  }
}
