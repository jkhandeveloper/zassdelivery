import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Pagination block echoed under `meta` on list responses. */
export class PaginationMetaDto {
  @ApiProperty({ example: 137, description: 'Total records matching the query.' })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 7 })
  totalPages!: number;

  @ApiProperty({ example: false })
  hasPreviousPage!: boolean;

  @ApiProperty({ example: true })
  hasNextPage!: boolean;
}

/**
 * The envelope every successful response is wrapped in by
 * `ResponseInterceptor`. Documented as a class so Swagger can reference it.
 */
export class ApiSuccessResponseDto<T = unknown> {
  @ApiProperty({ example: true })
  success!: true;

  @ApiProperty({ example: 200 })
  statusCode!: number;

  @ApiProperty({ example: 'OK' })
  message!: string;

  @ApiProperty({ description: 'Response payload.' })
  data!: T;

  @ApiPropertyOptional({ type: PaginationMetaDto })
  meta?: PaginationMetaDto;

  @ApiProperty({ example: '3f1c0b2e-9d5a-4b3e-8f1a-2c7d6e5b4a39' })
  requestId!: string;

  @ApiProperty({ example: '2026-08-04T09:12:33.412Z' })
  timestamp!: string;
}

/** The envelope produced by `AllExceptionsFilter` for every failure. */
export class ApiErrorResponseDto {
  @ApiProperty({ example: false })
  success!: false;

  @ApiProperty({ example: 400 })
  statusCode!: number;

  @ApiProperty({ example: 'Bad Request' })
  error!: string;

  @ApiProperty({ example: 'Validation failed' })
  message!: string;

  @ApiPropertyOptional({
    description: 'Field-level validation failures, when applicable.',
    example: ['phone must be a valid Pakistani mobile number'],
    type: [String],
  })
  details?: string[];

  @ApiProperty({ example: '/api/v1/users' })
  path!: string;

  @ApiProperty({ example: '3f1c0b2e-9d5a-4b3e-8f1a-2c7d6e5b4a39' })
  requestId!: string;

  @ApiProperty({ example: '2026-08-04T09:12:33.412Z' })
  timestamp!: string;
}
