import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Base class for errors that express a business rule violation rather than a
 * transport concern.
 *
 * Domain and application layers throw these; the HTTP layer never has to know
 * how a use-case failed, and `AllExceptionsFilter` renders them uniformly.
 * `errorCode` is a stable machine-readable identifier that clients can branch
 * on without string-matching human-readable messages.
 */
export abstract class DomainException extends HttpException {
  abstract readonly errorCode: string;

  protected constructor(message: string, status: HttpStatus) {
    super(message, status);
    this.name = new.target.name;
  }
}

/** The requested aggregate does not exist (or is soft-deleted). */
export class ResourceNotFoundException extends DomainException {
  readonly errorCode = 'RESOURCE_NOT_FOUND';

  constructor(resource: string, identifier?: string) {
    super(
      identifier === undefined
        ? `${resource} was not found.`
        : `${resource} with identifier "${identifier}" was not found.`,
      HttpStatus.NOT_FOUND,
    );
  }
}

/** The operation conflicts with existing state, e.g. a duplicate phone number. */
export class ResourceConflictException extends DomainException {
  readonly errorCode = 'RESOURCE_CONFLICT';

  constructor(message: string) {
    super(message, HttpStatus.CONFLICT);
  }
}

/** Input is well-formed but violates a business rule. */
export class BusinessRuleViolationException extends DomainException {
  readonly errorCode = 'BUSINESS_RULE_VIOLATION';

  constructor(message: string) {
    super(message, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

/** The caller is authenticated but not permitted to perform this action. */
export class ForbiddenOperationException extends DomainException {
  readonly errorCode = 'FORBIDDEN_OPERATION';

  constructor(message = 'You are not allowed to perform this action.') {
    super(message, HttpStatus.FORBIDDEN);
  }
}
