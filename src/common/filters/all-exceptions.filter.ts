import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
  type LoggerService,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { RequestContext } from '../context/request-context';
import { DomainException } from '../exceptions/domain.exception';

interface NormalisedError {
  status: number;
  error: string;
  message: string;
  details?: string[];
  errorCode?: string;
}

/**
 * The single exit point for every failure in the application.
 *
 * Guarantees a consistent error envelope, maps Prisma engine errors onto
 * meaningful HTTP semantics, and ensures internal details are logged but never
 * returned to clients in production.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly context = AllExceptionsFilter.name;

  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const normalised = this.normalise(exception);
    const requestId = RequestContext.getRequestId() ?? 'unknown';

    this.record(exception, normalised, request, requestId);

    response.status(normalised.status).json({
      success: false,
      statusCode: normalised.status,
      error: normalised.error,
      message: normalised.message,
      ...(normalised.errorCode !== undefined && { errorCode: normalised.errorCode }),
      ...(normalised.details !== undefined && { details: normalised.details }),
      path: request.originalUrl,
      requestId,
      timestamp: new Date().toISOString(),
    });
  }

  private normalise(exception: unknown): NormalisedError {
    if (exception instanceof DomainException) {
      return {
        status: exception.getStatus(),
        error: HttpStatus[exception.getStatus()] ?? 'Error',
        message: exception.message,
        errorCode: exception.errorCode,
      };
    }

    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrismaKnownError(exception);
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        message: 'The request could not be processed due to invalid data.',
        errorCode: 'DATABASE_VALIDATION_ERROR',
      };
    }

    if (
      exception instanceof Prisma.PrismaClientInitializationError ||
      exception instanceof Prisma.PrismaClientRustPanicError
    ) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        error: 'Service Unavailable',
        message: 'The database is currently unavailable. Please retry shortly.',
        errorCode: 'DATABASE_UNAVAILABLE',
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      // Deliberately generic: the real cause is written to the log with the
      // correlation id, so support can find it without exposing internals.
      message: 'An unexpected error occurred. Please contact support with the request id.',
      errorCode: 'INTERNAL_ERROR',
    };
  }

  private fromHttpException(exception: HttpException): NormalisedError {
    const status = exception.getStatus();
    const payload = exception.getResponse();

    if (typeof payload === 'string') {
      return { status, error: HttpStatus[status] ?? 'Error', message: payload };
    }

    const body = payload as { message?: string | string[]; error?: string };
    const rawMessage = body.message;

    // ValidationPipe reports every failed constraint as an array of strings.
    if (Array.isArray(rawMessage)) {
      return {
        status,
        error: body.error ?? 'Bad Request',
        message: 'Validation failed.',
        details: rawMessage,
        errorCode: 'VALIDATION_FAILED',
      };
    }

    return {
      status,
      error: body.error ?? HttpStatus[status] ?? 'Error',
      message: rawMessage ?? exception.message,
    };
  }

  private fromPrismaKnownError(exception: Prisma.PrismaClientKnownRequestError): NormalisedError {
    const target = this.describeTarget(exception.meta?.['target']);

    switch (exception.code) {
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          error: 'Conflict',
          message: target
            ? `A record with this ${target} already exists.`
            : 'A record with these details already exists.',
          errorCode: 'UNIQUE_CONSTRAINT_VIOLATION',
        };

      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          error: 'Not Found',
          message: 'The requested record does not exist.',
          errorCode: 'RECORD_NOT_FOUND',
        };

      case 'P2003':
        return {
          status: HttpStatus.CONFLICT,
          error: 'Conflict',
          message: 'This operation references a record that does not exist, or is still in use.',
          errorCode: 'FOREIGN_KEY_VIOLATION',
        };

      case 'P2000':
        return {
          status: HttpStatus.BAD_REQUEST,
          error: 'Bad Request',
          message: target
            ? `The value provided for ${target} is too long.`
            : 'A provided value exceeds the maximum allowed length.',
          errorCode: 'VALUE_TOO_LONG',
        };

      case 'P2011':
        return {
          status: HttpStatus.BAD_REQUEST,
          error: 'Bad Request',
          message: target ? `${target} is required.` : 'A required field was missing.',
          errorCode: 'NULL_CONSTRAINT_VIOLATION',
        };

      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'Internal Server Error',
          message: 'A database error occurred while processing the request.',
          errorCode: `PRISMA_${exception.code}`,
        };
    }
  }

  /** Renders Prisma's `meta.target` (string or string[]) as readable text. */
  private describeTarget(target: unknown): string | undefined {
    if (typeof target === 'string') {
      return target;
    }
    if (Array.isArray(target) && target.every((item): item is string => typeof item === 'string')) {
      return target.join(', ');
    }
    return undefined;
  }

  private record(
    exception: unknown,
    normalised: NormalisedError,
    request: Request,
    requestId: string,
  ): void {
    const summary = `${request.method} ${request.originalUrl} → ${normalised.status} ${normalised.message}`;

    // 5xx means we broke something: capture the stack. 4xx is the caller's
    // problem and only warrants a warning, otherwise logs fill with noise.
    if (normalised.status >= Number(HttpStatus.INTERNAL_SERVER_ERROR)) {
      const stack = exception instanceof Error ? exception.stack : String(exception);
      this.logger.error?.(summary, stack, this.context);
      return;
    }

    this.logger.warn?.(`${summary} [${requestId}]`, this.context);
  }
}
