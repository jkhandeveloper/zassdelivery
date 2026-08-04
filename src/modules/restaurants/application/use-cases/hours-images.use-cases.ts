import { Injectable } from '@nestjs/common';
import { DayOfWeek } from '@prisma/client';

import {
  BusinessRuleViolationException,
  ResourceNotFoundException,
} from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';

import { RestaurantRepository } from '../../domain/repositories/restaurant.repository';
import { OpeningHoursService, type OpenState } from '../../domain/services/opening-hours.service';
import {
  toHourDto,
  toImageDto,
  type BusinessHourResponseDto,
  type RestaurantImageDto,
} from '../dto/restaurant-response.dto';
import type {
  AddRestaurantImageDto,
  ReorderImagesDto,
  SetBusinessHoursDto,
} from '../dto/restaurant.dto';
import { assertCanManage } from './restaurants.use-cases';

/** Keeps the gallery to a size a phone can render without pagination. */
const MAX_IMAGES_PER_RESTAURANT = 12;

@Injectable()
export class GetBusinessHoursUseCase {
  constructor(
    private readonly restaurants: RestaurantRepository,
    private readonly openingHours: OpeningHoursService,
  ) {}

  async execute(
    restaurantId: string,
  ): Promise<{ hours: BusinessHourResponseDto[]; current: OpenState }> {
    const restaurant = await this.restaurants.findById(restaurantId);

    if (!restaurant) {
      throw new ResourceNotFoundException('Restaurant', restaurantId);
    }

    const hours = await this.restaurants.findHours(restaurantId);

    return { hours: hours.map(toHourDto), current: this.openingHours.evaluate(hours) };
  }
}

@Injectable()
export class SetBusinessHoursUseCase {
  constructor(private readonly restaurants: RestaurantRepository) {}

  async execute(
    restaurantId: string,
    dto: SetBusinessHoursDto,
    actor: AuthenticatedUser,
  ): Promise<BusinessHourResponseDto[]> {
    const restaurant = await this.restaurants.findById(restaurantId, true);

    if (!restaurant) {
      throw new ResourceNotFoundException('Restaurant', restaurantId);
    }

    assertCanManage(restaurant, actor);

    const seen = new Set<DayOfWeek>();

    for (const entry of dto.hours) {
      if (seen.has(entry.dayOfWeek)) {
        throw new BusinessRuleViolationException(`${entry.dayOfWeek} is listed more than once.`);
      }
      seen.add(entry.dayOfWeek);

      // Equal times are rejected rather than silently read as a 24-hour or
      // zero-length window — the intent is genuinely ambiguous.
      if (!entry.isClosed && entry.opensAt === entry.closesAt) {
        throw new BusinessRuleViolationException(
          `${entry.dayOfWeek}: opensAt and closesAt cannot be identical. Use isClosed for a closed day.`,
        );
      }
    }

    // Days the caller omitted are stored as closed, so the request is a full
    // replacement of the week and no stale row survives a save.
    const week = Object.values(DayOfWeek).map((day) => {
      const supplied = dto.hours.find((entry) => entry.dayOfWeek === day);

      return supplied
        ? {
            dayOfWeek: day,
            opensAt: supplied.opensAt,
            closesAt: supplied.closesAt,
            isClosed: supplied.isClosed ?? false,
          }
        : { dayOfWeek: day, opensAt: '00:00', closesAt: '00:00', isClosed: true };
    });

    const saved = await this.restaurants.replaceHours(restaurantId, week);

    return saved.map(toHourDto);
  }
}

@Injectable()
export class ListRestaurantImagesUseCase {
  constructor(private readonly restaurants: RestaurantRepository) {}

  async execute(restaurantId: string): Promise<RestaurantImageDto[]> {
    const restaurant = await this.restaurants.findById(restaurantId);

    if (!restaurant) {
      throw new ResourceNotFoundException('Restaurant', restaurantId);
    }

    return (await this.restaurants.findImages(restaurantId)).map(toImageDto);
  }
}

@Injectable()
export class AddRestaurantImageUseCase {
  constructor(private readonly restaurants: RestaurantRepository) {}

  async execute(
    restaurantId: string,
    dto: AddRestaurantImageDto,
    actor: AuthenticatedUser,
  ): Promise<RestaurantImageDto> {
    const restaurant = await this.restaurants.findById(restaurantId, true);

    if (!restaurant) {
      throw new ResourceNotFoundException('Restaurant', restaurantId);
    }

    assertCanManage(restaurant, actor);

    const count = await this.restaurants.countImages(restaurantId);

    if (count >= MAX_IMAGES_PER_RESTAURANT) {
      throw new BusinessRuleViolationException(
        `A restaurant may have at most ${MAX_IMAGES_PER_RESTAURANT} images. Delete one to add another.`,
      );
    }

    const image = await this.restaurants.addImage(restaurantId, {
      url: dto.url,
      caption: dto.caption ?? null,
      // New images land at the end of the gallery.
      sortOrder: count,
    });

    return toImageDto(image);
  }
}

@Injectable()
export class DeleteRestaurantImageUseCase {
  constructor(private readonly restaurants: RestaurantRepository) {}

  async execute(
    restaurantId: string,
    imageId: string,
    actor: AuthenticatedUser,
  ): Promise<{ message: string }> {
    const restaurant = await this.restaurants.findById(restaurantId, true);

    if (!restaurant) {
      throw new ResourceNotFoundException('Restaurant', restaurantId);
    }

    assertCanManage(restaurant, actor);

    const image = await this.restaurants.findImageById(imageId);

    // Checking ownership of the image as well as the restaurant stops a caller
    // deleting another restaurant's photo by pairing ids from two listings.
    if (!image || image.restaurantId !== restaurantId) {
      throw new ResourceNotFoundException('Image', imageId);
    }

    await this.restaurants.deleteImage(imageId);

    return { message: 'Image deleted.' };
  }
}

@Injectable()
export class ReorderRestaurantImagesUseCase {
  constructor(private readonly restaurants: RestaurantRepository) {}

  async execute(
    restaurantId: string,
    dto: ReorderImagesDto,
    actor: AuthenticatedUser,
  ): Promise<RestaurantImageDto[]> {
    const restaurant = await this.restaurants.findById(restaurantId, true);

    if (!restaurant) {
      throw new ResourceNotFoundException('Restaurant', restaurantId);
    }

    assertCanManage(restaurant, actor);

    const existing = await this.restaurants.findImages(restaurantId);
    const existingIds = new Set(existing.map((image) => image.id));

    // A partial list would leave the omitted images with stale positions and a
    // gallery that renders in an order nobody chose.
    if (dto.imageIds.length !== existing.length) {
      throw new BusinessRuleViolationException(
        `Provide all ${existing.length} image ids in the desired order.`,
      );
    }

    const unknown = dto.imageIds.filter((id) => !existingIds.has(id));

    if (unknown.length > 0) {
      throw new BusinessRuleViolationException(
        `These images do not belong to this restaurant: ${unknown.join(', ')}.`,
      );
    }

    return (await this.restaurants.reorderImages(restaurantId, dto.imageIds)).map(toImageDto);
  }
}
