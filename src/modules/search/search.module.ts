import { Module } from '@nestjs/common';

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
import { SearchRepository } from './domain/repositories/search.repository';
import { SearchCacheService } from './infrastructure/cache/search-cache.service';
import { PrismaSearchRepository } from './infrastructure/repositories/prisma-search.repository';
import { SearchController } from './search.controller';

/**
 * Read-only discovery. Depends on no other feature module: it reaches the
 * catalogue through its own SQL rather than through the restaurant and menu
 * repositories, because ranking, geo filtering and aggregate counts have to be
 * expressed in one query to be paginated correctly.
 */
@Module({
  controllers: [SearchController],
  providers: [
    SearchCacheService,

    GlobalSearchUseCase,
    SearchRestaurantsUseCase,
    SearchFoodUseCase,
    SearchCategoriesUseCase,
    NearbySearchUseCase,
    TrendingUseCase,
    PopularUseCase,
    AutocompleteUseCase,

    { provide: SearchRepository, useClass: PrismaSearchRepository },
  ],
  exports: [SearchRepository, SearchCacheService],
})
export class SearchModule {}
