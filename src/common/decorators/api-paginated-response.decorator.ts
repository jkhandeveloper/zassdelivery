import { applyDecorators, type Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';

import { PaginationMetaDto } from '../dto/api-response.dto';

/**
 * Documents a paginated list endpoint, describing the real wire shape produced
 * by `ResponseInterceptor` (envelope + hoisted `meta`) rather than the bare
 * array the controller returns.
 */
export function ApiPaginatedResponse<TModel extends Type<unknown>>(
  model: TModel,
  description = 'Paginated list retrieved successfully.',
) {
  return applyDecorators(
    ApiExtraModels(model, PaginationMetaDto),
    ApiOkResponse({
      description,
      schema: {
        type: 'object',
        required: ['success', 'statusCode', 'message', 'data', 'meta', 'requestId', 'timestamp'],
        properties: {
          success: { type: 'boolean', example: true },
          statusCode: { type: 'number', example: 200 },
          message: { type: 'string', example: 'OK' },
          data: {
            type: 'array',
            items: { $ref: getSchemaPath(model) },
          },
          meta: { $ref: getSchemaPath(PaginationMetaDto) },
          requestId: { type: 'string', format: 'uuid' },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
    }),
  );
}
