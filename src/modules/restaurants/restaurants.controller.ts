import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ApiPaginatedResponse } from '@/common/decorators/api-paginated-response.decorator';
import { Public } from '@/common/decorators/public.decorator';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

import {
  ListCategoriesQueryDto,
  SearchRestaurantsQueryDto,
} from './application/dto/restaurant-query.dto';
import {
  BusinessHourResponseDto,
  RestaurantDto,
  RestaurantImageDto,
} from './application/dto/restaurant-response.dto';
import {
  ListCategoriesUseCase,
  type CategoryDto,
} from './application/use-cases/categories.use-cases';
import {
  GetBusinessHoursUseCase,
  ListRestaurantImagesUseCase,
} from './application/use-cases/hours-images.use-cases';
import {
  GetRestaurantUseCase,
  SearchRestaurantsUseCase,
} from './application/use-cases/restaurants.use-cases';
import type { OpenState } from './domain/services/opening-hours.service';

/**
 * The public storefront. Every route here is unauthenticated — customers browse
 * before they sign in — and only ever exposes approved, non-deleted listings.
 */
@ApiTags('Restaurants')
@Public()
@Controller('restaurants')
export class RestaurantsController {
  constructor(
    private readonly search: SearchRestaurantsUseCase,
    private readonly getRestaurant: GetRestaurantUseCase,
    private readonly getHours: GetBusinessHoursUseCase,
    private readonly listImages: ListRestaurantImagesUseCase,
    private readonly listCategories: ListCategoriesUseCase,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Search restaurants',
    description:
      'Paginated, filterable and sortable. Supply latitude and longitude to ' +
      'limit results to restaurants whose delivery radius actually reaches the ' +
      'customer, and to have distanceMeters returned on each row. Only approved ' +
      'listings are ever returned.',
  })
  @ApiPaginatedResponse(RestaurantDto)
  list(@Query() query: SearchRestaurantsQueryDto): Promise<PaginatedResult<RestaurantDto>> {
    return this.search.execute(query);
  }

  @Get('categories')
  @ApiOperation({ summary: 'List cuisine categories' })
  @ApiPaginatedResponse(Object)
  categories(@Query() query: ListCategoriesQueryDto): Promise<PaginatedResult<CategoryDto>> {
    return this.listCategories.execute(query);
  }

  @Get(':slug')
  @ApiParam({ name: 'slug', example: 'chapli-kabab-house-pabbi' })
  @ApiOperation({
    summary: 'Get a restaurant by slug',
    description:
      'Includes images, the weekly schedule, and canOrderNow — the single flag ' +
      'a client should use to enable the order button.',
  })
  @ApiResponse({ status: 200, type: RestaurantDto })
  @ApiResponse({ status: 404, description: 'No approved restaurant with that slug.' })
  detail(@Param('slug') slug: string): Promise<RestaurantDto> {
    return this.getRestaurant.bySlug(slug);
  }

  @Get(':id/hours')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Get business hours',
    description: 'Includes whether the restaurant is open right now in Asia/Karachi.',
  })
  @ApiResponse({ status: 200, type: [BusinessHourResponseDto] })
  hours(
    @Param('id') id: string,
  ): Promise<{ hours: BusinessHourResponseDto[]; current: OpenState }> {
    return this.getHours.execute(id);
  }

  @Get(':id/images')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Get the restaurant gallery' })
  @ApiResponse({ status: 200, type: [RestaurantImageDto] })
  images(@Param('id') id: string): Promise<RestaurantImageDto[]> {
    return this.listImages.execute(id);
  }
}
