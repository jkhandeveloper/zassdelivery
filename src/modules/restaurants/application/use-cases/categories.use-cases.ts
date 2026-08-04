import { Injectable } from '@nestjs/common';
import type { RestaurantCategory } from '@prisma/client';

import {
  BusinessRuleViolationException,
  ResourceConflictException,
  ResourceNotFoundException,
} from '@/common/exceptions/domain.exception';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { buildOrderBy } from '@/common/utils/pagination.util';

import { RestaurantCategoryRepository } from '../../domain/repositories/restaurant-category.repository';
import { CATEGORY_SORT_FIELDS, type ListCategoriesQueryDto } from '../dto/restaurant-query.dto';
import type {
  CreateRestaurantCategoryDto,
  UpdateRestaurantCategoryDto,
} from '../dto/restaurant.dto';
import { slugify } from './restaurants.use-cases';

export interface CategoryDto {
  id: string;
  name: string;
  nameUr: string | null;
  slug: string;
  iconUrl: string | null;
  sortOrder: number;
  isActive: boolean;
}

function toCategoryDto(category: RestaurantCategory): CategoryDto {
  return {
    id: category.id,
    name: category.name,
    nameUr: category.nameUr,
    slug: category.slug,
    iconUrl: category.iconUrl,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
  };
}

@Injectable()
export class ListCategoriesUseCase {
  constructor(private readonly categories: RestaurantCategoryRepository) {}

  async execute(query: ListCategoriesQueryDto): Promise<PaginatedResult<CategoryDto>> {
    const orderBy = buildOrderBy(query.sortBy, query.sortOrder, CATEGORY_SORT_FIELDS, 'sortOrder');

    const result = await this.categories.findMany({
      page: query.page,
      limit: query.limit,
      orderBy,
      search: query.search,
      activeOnly: query.activeOnly,
    });

    return { items: result.items.map(toCategoryDto), meta: result.meta };
  }
}

@Injectable()
export class CreateCategoryUseCase {
  constructor(private readonly categories: RestaurantCategoryRepository) {}

  async execute(dto: CreateRestaurantCategoryDto): Promise<CategoryDto> {
    const slug = dto.slug ?? slugify(dto.name);

    if (slug.length === 0) {
      throw new BusinessRuleViolationException(
        'A slug could not be derived from that name. Please supply one explicitly.',
      );
    }

    if (await this.categories.slugExists(slug)) {
      throw new ResourceConflictException(`A category with the slug "${slug}" already exists.`);
    }

    return toCategoryDto(
      await this.categories.create({
        name: dto.name,
        nameUr: dto.nameUr ?? null,
        slug,
        iconUrl: dto.iconUrl ?? null,
        sortOrder: dto.sortOrder,
        isActive: dto.isActive,
      }),
    );
  }
}

@Injectable()
export class UpdateCategoryUseCase {
  constructor(private readonly categories: RestaurantCategoryRepository) {}

  async execute(id: string, dto: UpdateRestaurantCategoryDto): Promise<CategoryDto> {
    const existing = await this.categories.findById(id);

    if (!existing) {
      throw new ResourceNotFoundException('Category', id);
    }

    if (dto.slug && (await this.categories.slugExists(dto.slug, id))) {
      throw new ResourceConflictException(`A category with the slug "${dto.slug}" already exists.`);
    }

    return toCategoryDto(await this.categories.update(id, dto));
  }
}

@Injectable()
export class DeleteCategoryUseCase {
  constructor(private readonly categories: RestaurantCategoryRepository) {}

  async execute(id: string): Promise<{ message: string }> {
    const existing = await this.categories.findById(id);

    if (!existing) {
      throw new ResourceNotFoundException('Category', id);
    }

    const inUse = await this.categories.countRestaurants(id);

    // Deleting would cascade the assignment rows away and silently strip the
    // category from every restaurant using it. Deactivating hides it from
    // customers while leaving those links intact.
    if (inUse > 0) {
      throw new BusinessRuleViolationException(
        `${inUse} restaurant(s) use this category. Deactivate it instead of deleting it.`,
      );
    }

    await this.categories.delete(id);

    return { message: 'Category deleted.' };
  }
}
