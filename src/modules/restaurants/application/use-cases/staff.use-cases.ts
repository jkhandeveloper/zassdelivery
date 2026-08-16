import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import {
  ForbiddenOperationException,
  ResourceConflictException,
  ResourceNotFoundException,
} from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { PasswordService } from '@/modules/auth/application/services/password.service';
import { UserRepository } from '@/modules/users/domain/repositories/user.repository';

import { RestaurantRepository } from '../../domain/repositories/restaurant.repository';
import type { RegisterRestaurantStaffDto } from '../dto/restaurant-staff.dto';
import { toRestaurantStaffDto, type RestaurantStaffDto } from '../dto/restaurant-staff.dto';
import { assertCanManage } from './restaurants.use-cases';

@Injectable()
export class RegisterRestaurantStaffUseCase {
  constructor(
    private readonly restaurants: RestaurantRepository,
    private readonly users: UserRepository,
    private readonly passwords: PasswordService,
  ) {}

  async execute(
    restaurantId: string,
    dto: RegisterRestaurantStaffDto,
    actor: AuthenticatedUser,
  ): Promise<RestaurantStaffDto> {
    const restaurant = await this.restaurants.findById(restaurantId);

    if (!restaurant) {
      throw new ResourceNotFoundException('Restaurant', restaurantId);
    }

    // Confirms the actor may see this restaurant at all (404s otherwise).
    assertCanManage(restaurant, actor);

    // A staff account creating another staff account has no one to answer
    // for it; only the owner (or platform staff, via assertCanManage above)
    // grows the roster.
    if (actor.role === UserRole.VENDOR_STAFF) {
      throw new ForbiddenOperationException('Only the restaurant owner may register staff.');
    }

    if (await this.users.existsByPhone(dto.phone)) {
      throw new ResourceConflictException('An account with this phone number already exists.');
    }

    if (dto.email && (await this.users.existsByEmail(dto.email))) {
      throw new ResourceConflictException('An account with this email address already exists.');
    }

    const passwordHash = await this.passwords.hash(dto.password);

    const user = await this.users.create({
      phone: dto.phone,
      fullName: dto.fullName,
      role: UserRole.VENDOR_STAFF,
      email: dto.email ?? null,
      passwordHash,
      staffRestaurantId: restaurant.id,
    });

    return toRestaurantStaffDto(user);
  }
}

@Injectable()
export class ListRestaurantStaffUseCase {
  constructor(
    private readonly restaurants: RestaurantRepository,
    private readonly users: UserRepository,
  ) {}

  async execute(restaurantId: string, actor: AuthenticatedUser): Promise<RestaurantStaffDto[]> {
    const restaurant = await this.restaurants.findById(restaurantId);

    if (!restaurant) {
      throw new ResourceNotFoundException('Restaurant', restaurantId);
    }

    assertCanManage(restaurant, actor);

    const staff = await this.users.findStaffByRestaurant(restaurant.id);

    return staff.map(toRestaurantStaffDto);
  }
}
