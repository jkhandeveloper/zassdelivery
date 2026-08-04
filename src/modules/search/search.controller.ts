import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { ApiPaginatedResponse } from '@/common/decorators/api-paginated-response.decorator';
import { Public } from '@/common/decorators/public.decorator';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

import {
  AutocompleteDto,
  NearbySearchDto,
  PopularDto,
  SearchCategoriesDto,
  SearchFoodDto,
  SearchRestaurantsDto,
  TrendingDto,
} from './application/dto/search-query.dto';
import {
  AutocompleteHitDto,
  CategoryHitDto,
  FoodHitDto,
  GlobalSearchDto,
  PopularFoodHitDto,
  RestaurantHitDto,
  TrendingHitDto,
} from './application/dto/search-response.dto';
import {
  AutocompleteUseCase,
  GlobalSearchUseCase,
  NearbySearchUseCase,
  PopularUseCase,
  SearchCategoriesUseCase,
  SearchFoodUseCase,
  SearchRestaurantsUseCase,
  TrendingUseCase,
} from './application/use-cases/search.use-cases';

/**
 * Discovery. Every route is public — search is the first thing a customer does,
 * long before signing in — and only ever returns approved, orderable listings.
 *
 * Results are cached in Redis with per-endpoint lifetimes; a Redis outage
 * degrades these to direct database reads rather than failing the request.
 */
@ApiTags('Search')
@Public()
@Controller('search')
export class SearchController {
  constructor(
    private readonly globalSearch: GlobalSearchUseCase,
    private readonly restaurants: SearchRestaurantsUseCase,
    private readonly food: SearchFoodUseCase,
    private readonly categories: SearchCategoriesUseCase,
    private readonly nearby: NearbySearchUseCase,
    private readonly trending: TrendingUseCase,
    private readonly popular: PopularUseCase,
    private readonly autocomplete: AutocompleteUseCase,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Global search',
    description:
      'Restaurants, dishes and categories in one call, five of each — the ' +
      'combined results screen. The three queries run concurrently.',
  })
  @ApiResponse({ status: 200, type: GlobalSearchDto })
  all(@Query() query: SearchRestaurantsDto): Promise<GlobalSearchDto> {
    return this.globalSearch.execute(query);
  }

  @Get('restaurants')
  @ApiOperation({
    summary: 'Search restaurants',
    description:
      'PostgreSQL full-text search over name and description, ranked with ' +
      'ts_rank and weighted so a name match outranks a description match. ' +
      'Accepts quoted phrases and negation, e.g. `"chapli kabab" -pizza`. ' +
      'Supply coordinates to limit results to restaurants that can actually ' +
      'deliver there.',
  })
  @ApiPaginatedResponse(RestaurantHitDto)
  searchRestaurants(
    @Query() query: SearchRestaurantsDto,
  ): Promise<PaginatedResult<RestaurantHitDto>> {
    return this.restaurants.execute(query);
  }

  @Get('food')
  @ApiOperation({
    summary: 'Search dishes across restaurants',
    description:
      'Full-text search over dish names and descriptions. Only available dishes ' +
      'from live restaurants are returned.',
  })
  @ApiPaginatedResponse(FoodHitDto)
  searchFood(@Query() query: SearchFoodDto): Promise<PaginatedResult<FoodHitDto>> {
    return this.food.execute(query);
  }

  @Get('categories')
  @ApiOperation({
    summary: 'Search cuisine categories',
    description: 'Ordered by how many active restaurants each one holds.',
  })
  @ApiResponse({ status: 200, type: [CategoryHitDto] })
  searchCategories(@Query() query: SearchCategoriesDto): Promise<CategoryHitDto[]> {
    return this.categories.execute(query);
  }

  @Get('nearby')
  @ApiOperation({
    summary: 'Restaurants that deliver to a location',
    description:
      'Nearest first. The radius is capped by each restaurant’s own delivery ' +
      'radius, so a result here can genuinely serve the address.',
  })
  @ApiPaginatedResponse(RestaurantHitDto)
  searchNearby(@Query() query: NearbySearchDto): Promise<PaginatedResult<RestaurantHitDto>> {
    return this.nearby.execute(query);
  }

  @Get('trending')
  @ApiOperation({
    summary: 'Trending restaurants',
    description:
      'Ranked by delivered orders inside a rolling window (7 days by default), ' +
      'so newly popular places can surface rather than the same long-established ' +
      'names sitting at the top forever.',
  })
  @ApiResponse({ status: 200, type: [TrendingHitDto] })
  getTrending(@Query() query: TrendingDto): Promise<TrendingHitDto[]> {
    return this.trending.execute(query);
  }

  @Get('popular')
  @ApiOperation({
    summary: 'Popular dishes',
    description: 'Lifetime order counts, broken by rating.',
  })
  @ApiResponse({ status: 200, type: [PopularFoodHitDto] })
  getPopular(@Query() query: PopularDto): Promise<PopularFoodHitDto[]> {
    return this.popular.execute(query);
  }

  @Get('autocomplete')
  // Fires on nearly every keystroke, so it gets a much larger budget than the
  // global default — while still being bounded.
  @Throttle({ default: { limit: 300, ttl: 60000 } })
  @ApiOperation({
    summary: 'Type-ahead suggestions',
    description:
      'Restaurants, dishes and categories matched on trigram similarity rather ' +
      'than full text: a half-typed word is not a lexeme, and trigrams tolerate ' +
      'the typos a phone keyboard produces. Exact prefixes score 1 and rank first.',
  })
  @ApiResponse({ status: 200, type: [AutocompleteHitDto] })
  getAutocomplete(@Query() query: AutocompleteDto): Promise<AutocompleteHitDto[]> {
    return this.autocomplete.execute(query);
  }
}
