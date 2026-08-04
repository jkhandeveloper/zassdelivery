import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '@/common/decorators/permissions.decorator';
import { ApiErrorResponseDto } from '@/common/dto/api-response.dto';

import { MessageResponseDto } from '../auth/application/dto/auth-response.dto';
import {
  CreateRestaurantCategoryDto,
  UpdateRestaurantCategoryDto,
} from './application/dto/restaurant.dto';
import {
  CreateCategoryUseCase,
  DeleteCategoryUseCase,
  UpdateCategoryUseCase,
  type CategoryDto,
} from './application/use-cases/categories.use-cases';

/**
 * Category administration. Reading is public and lives on the storefront
 * controller; only writes are gated here.
 */
@ApiTags('Restaurant Categories (Admin)')
@ApiBearerAuth('access-token')
@ApiResponse({ status: 401, description: 'Not authenticated.', type: ApiErrorResponseDto })
@ApiResponse({ status: 403, description: 'Missing permission.', type: ApiErrorResponseDto })
@Controller('restaurant-categories')
export class RestaurantCategoriesController {
  constructor(
    private readonly createCategory: CreateCategoryUseCase,
    private readonly updateCategory: UpdateCategoryUseCase,
    private readonly deleteCategory: DeleteCategoryUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('restaurants.create')
  @ApiOperation({
    summary: 'Create a cuisine category',
    description: 'The slug is derived from the name when not supplied.',
  })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 409, description: 'Slug already in use.' })
  create(@Body() dto: CreateRestaurantCategoryDto): Promise<CategoryDto> {
    return this.createCategory.execute(dto);
  }

  @Patch(':id')
  @RequirePermissions('restaurants.update')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Update a cuisine category' })
  @ApiResponse({ status: 200 })
  update(@Param('id') id: string, @Body() dto: UpdateRestaurantCategoryDto): Promise<CategoryDto> {
    return this.updateCategory.execute(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('restaurants.delete')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Delete a cuisine category',
    description:
      'Refused while any restaurant still uses it — deleting would cascade the ' +
      'assignments away and silently strip the category from those listings. ' +
      'Deactivate it instead.',
  })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  @ApiResponse({ status: 422, description: 'Category still in use.' })
  remove(@Param('id') id: string): Promise<MessageResponseDto> {
    return this.deleteCategory.execute(id);
  }
}
