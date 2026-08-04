import { Injectable } from '@nestjs/common';
import { AddressLabel } from '@prisma/client';

import {
  BusinessRuleViolationException,
  ForbiddenOperationException,
  ResourceNotFoundException,
} from '@/common/exceptions/domain.exception';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { buildOrderBy } from '@/common/utils/pagination.util';

import { AddressRepository } from '../../domain/repositories/address.repository';
import type { CreateAddressDto, UpdateAddressDto } from '../dto/address.dto';
import { ADDRESS_SORT_FIELDS, type ListAddressesQueryDto } from '../dto/user-query.dto';
import { toAddressDto, type AddressDto } from '../dto/user-response.dto';

/** Keeps a single account's address book from growing without bound. */
const MAX_ADDRESSES_PER_USER = 20;

@Injectable()
export class ListAddressesUseCase {
  constructor(private readonly addresses: AddressRepository) {}

  async execute(
    userId: string,
    query: ListAddressesQueryDto,
  ): Promise<PaginatedResult<AddressDto>> {
    const orderBy = buildOrderBy(query.sortBy, query.sortOrder, ADDRESS_SORT_FIELDS, 'createdAt');

    const result = await this.addresses.findMany({
      userId,
      page: query.page,
      limit: query.limit,
      orderBy,
      search: query.search,
      label: query.label,
    });

    return { items: result.items.map(toAddressDto), meta: result.meta };
  }
}

/**
 * Loads an address and proves it belongs to the caller.
 *
 * A 404 rather than a 403 for someone else's address: telling an attacker that
 * an id exists but is not theirs is itself a disclosure.
 */
@Injectable()
export class GetAddressUseCase {
  constructor(private readonly addresses: AddressRepository) {}

  async execute(userId: string, addressId: string): Promise<AddressDto> {
    const address = await this.addresses.findById(addressId);

    if (!address || address.userId !== userId || address.deletedAt !== null) {
      throw new ResourceNotFoundException('Address', addressId);
    }

    return toAddressDto(address);
  }
}

@Injectable()
export class CreateAddressUseCase {
  constructor(private readonly addresses: AddressRepository) {}

  async execute(userId: string, dto: CreateAddressDto): Promise<AddressDto> {
    const existingCount = await this.addresses.countForUser(userId);

    if (existingCount >= MAX_ADDRESSES_PER_USER) {
      throw new BusinessRuleViolationException(
        `You can save at most ${MAX_ADDRESSES_PER_USER} addresses. Delete one to add another.`,
      );
    }

    // The zone is derived from the coordinates rather than trusted from the
    // client: delivery fees and serviceability are priced off it, so letting a
    // caller pick their own zone would let them pick their own fee.
    const zone = await this.addresses.resolveZone(dto.latitude, dto.longitude);

    if (!zone) {
      throw new BusinessRuleViolationException(
        'This location is outside our delivery area. We currently serve Pabbi, Nowshera and Peshawar.',
      );
    }

    const address = await this.addresses.create(userId, {
      label: dto.label ?? AddressLabel.HOME,
      line1: dto.line1,
      line2: dto.line2 ?? null,
      landmark: dto.landmark ?? null,
      cityId: zone.cityId,
      zoneId: zone.id,
      latitude: dto.latitude,
      longitude: dto.longitude,
      recipientName: dto.recipientName ?? null,
      recipientPhone: dto.recipientPhone ?? null,
      deliveryNotes: dto.deliveryNotes ?? null,
      // The first address a user saves becomes their default automatically —
      // otherwise checkout would have nothing preselected.
      isDefault: dto.isDefault === true || existingCount === 0,
    });

    return toAddressDto(address);
  }
}

@Injectable()
export class UpdateAddressUseCase {
  constructor(private readonly addresses: AddressRepository) {}

  async execute(userId: string, addressId: string, dto: UpdateAddressDto): Promise<AddressDto> {
    const existing = await this.addresses.findById(addressId);

    if (!existing || existing.userId !== userId || existing.deletedAt !== null) {
      throw new ResourceNotFoundException('Address', addressId);
    }

    const patch: Parameters<AddressRepository['update']>[1] = { ...dto };

    // Moving the pin can move the address into a different zone — or out of
    // the service area entirely — so re-resolve whenever either changes.
    if (dto.latitude !== undefined || dto.longitude !== undefined) {
      const latitude = dto.latitude ?? existing.latitude;
      const longitude = dto.longitude ?? existing.longitude;
      const zone = await this.addresses.resolveZone(latitude, longitude);

      if (!zone) {
        throw new BusinessRuleViolationException('That location is outside our delivery area.');
      }

      patch.zoneId = zone.id;
      patch.cityId = zone.cityId;
    }

    // Defaults are promoted through setDefault so the "one default" invariant
    // stays in one place.
    delete patch.isDefault;

    const updated = await this.addresses.update(addressId, patch);

    if (dto.isDefault === true && !existing.isDefault) {
      return toAddressDto(await this.addresses.setDefault(userId, addressId));
    }

    return toAddressDto(updated);
  }
}

@Injectable()
export class SetDefaultAddressUseCase {
  constructor(private readonly addresses: AddressRepository) {}

  async execute(userId: string, addressId: string): Promise<AddressDto> {
    const existing = await this.addresses.findById(addressId);

    if (!existing || existing.userId !== userId || existing.deletedAt !== null) {
      throw new ResourceNotFoundException('Address', addressId);
    }

    if (existing.zoneId === null) {
      throw new BusinessRuleViolationException(
        'This address is outside our delivery area and cannot be made the default.',
      );
    }

    return toAddressDto(await this.addresses.setDefault(userId, addressId));
  }
}

@Injectable()
export class DeleteAddressUseCase {
  constructor(private readonly addresses: AddressRepository) {}

  async execute(userId: string, addressId: string): Promise<{ message: string }> {
    const existing = await this.addresses.findById(addressId);

    if (!existing || existing.deletedAt !== null) {
      throw new ResourceNotFoundException('Address', addressId);
    }

    if (existing.userId !== userId) {
      throw new ForbiddenOperationException('You can only delete your own addresses.');
    }

    // Soft delete: past orders snapshot the address text, but the row is still
    // referenced and must keep resolving for order history.
    await this.addresses.softDelete(addressId);

    return { message: 'Address deleted.' };
  }
}
