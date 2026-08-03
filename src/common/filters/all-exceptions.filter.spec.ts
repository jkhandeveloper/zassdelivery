import {
  type ArgumentsHost,
  BadRequestException,
  HttpStatus,
  NotFoundException,
  type LoggerService,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  BusinessRuleViolationException,
  ResourceNotFoundException,
} from '../exceptions/domain.exception';
import { AllExceptionsFilter } from './all-exceptions.filter';

interface CapturedResponse {
  status: number;
  body: Record<string, unknown>;
}

function createHost(captured: CapturedResponse): ArgumentsHost {
  const response = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      captured.body = body;
      return this;
    },
  };

  return {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ method: 'GET', originalUrl: '/api/v1/users' }),
    }),
  } as unknown as ArgumentsHost;
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let logger: jest.Mocked<LoggerService>;
  let captured: CapturedResponse;

  beforeEach(() => {
    logger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };

    filter = new AllExceptionsFilter(logger);
    captured = { status: 0, body: {} };
  });

  it('renders a domain exception with its stable error code', () => {
    filter.catch(new ResourceNotFoundException('User', 'usr_1'), createHost(captured));

    expect(captured.status).toBe(HttpStatus.NOT_FOUND);
    expect(captured.body).toMatchObject({
      success: false,
      statusCode: 404,
      errorCode: 'RESOURCE_NOT_FOUND',
      path: '/api/v1/users',
    });
  });

  it('maps a business rule violation to 422', () => {
    filter.catch(new BusinessRuleViolationException('Order below minimum'), createHost(captured));

    expect(captured.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(captured.body.errorCode).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('flattens ValidationPipe messages into details', () => {
    const exception = new BadRequestException({
      message: ['phone must be valid', 'fullName should not be empty'],
      error: 'Bad Request',
      statusCode: 400,
    });

    filter.catch(exception, createHost(captured));

    expect(captured.body.message).toBe('Validation failed.');
    expect(captured.body.details).toEqual(['phone must be valid', 'fullName should not be empty']);
    expect(captured.body.errorCode).toBe('VALIDATION_FAILED');
  });

  it('maps a Prisma unique violation to 409 and names the conflicting field', () => {
    const exception = new Prisma.PrismaClientKnownRequestError('Unique failed', {
      code: 'P2002',
      clientVersion: '6.19.3',
      meta: { target: ['phone'] },
    });

    filter.catch(exception, createHost(captured));

    expect(captured.status).toBe(HttpStatus.CONFLICT);
    expect(captured.body.message).toContain('phone');
    expect(captured.body.errorCode).toBe('UNIQUE_CONSTRAINT_VIOLATION');
  });

  it('maps a Prisma missing-record error to 404', () => {
    const exception = new Prisma.PrismaClientKnownRequestError('Not found', {
      code: 'P2025',
      clientVersion: '6.19.3',
    });

    filter.catch(exception, createHost(captured));

    expect(captured.status).toBe(HttpStatus.NOT_FOUND);
    expect(captured.body.errorCode).toBe('RECORD_NOT_FOUND');
  });

  it('never leaks internal details for an unexpected error', () => {
    filter.catch(new Error('connection string root:hunter2@db'), createHost(captured));

    expect(captured.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(JSON.stringify(captured.body)).not.toContain('hunter2');
    expect(captured.body.message).toMatch(/unexpected error/i);
  });

  it('logs 5xx with a stack trace but 4xx only as a warning', () => {
    filter.catch(new Error('boom'), createHost(captured));
    expect(logger.error).toHaveBeenCalledTimes(1);

    filter.catch(new NotFoundException('missing'), createHost(captured));
    expect(logger.warn).toHaveBeenCalledTimes(1);
    // Still only the single 5xx call — a 404 must not be logged as an error.
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('always includes a request id and timestamp', () => {
    filter.catch(new NotFoundException('missing'), createHost(captured));

    expect(captured.body.requestId).toBeDefined();
    expect(typeof captured.body.timestamp).toBe('string');
  });
});
