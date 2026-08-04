import type { Address, AddressLabel, Prisma } from '@prisma/client';

import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

export interface ListAddressesFilter {
  userId: string;
  page: number;
  limit: number;
  orderBy: Prisma.AddressOrderByWithRelationInput;
  search?: string;
  label?: AddressLabel;
}

export interface AddressInput {
  label: AddressLabel;
  line1: string;
  line2?: string | null;
  landmark?: string | null;
  cityId: string;
  zoneId?: string | null;
  latitude: number;
  longitude: number;
  recipientName?: string | null;
  recipientPhone?: string | null;
  deliveryNotes?: string | null;
  isDefault?: boolean;
}

/** A zone whose service radius contains a given point. */
export interface ZoneMatch {
  id: string;
  cityId: string;
  name: string;
  distanceMeters: number;
}

export abstract class AddressRepository {
  abstract findMany(filter: ListAddressesFilter): Promise<PaginatedResult<Address>>;
  abstract findById(id: string): Promise<Address | null>;
  abstract create(userId: string, input: AddressInput): Promise<Address>;
  abstract update(id: string, input: Partial<AddressInput>): Promise<Address>;
  abstract softDelete(id: string): Promise<void>;
  abstract countForUser(userId: string): Promise<number>;

  /**
   * Promotes one address to default and demotes the rest, atomically.
   *
   * A partial unique index allows only one default per user, so this cannot be
   * two independent writes without risking a constraint violation in between.
   */
  abstract setDefault(userId: string, addressId: string): Promise<Address>;

  /**
   * Finds the serviceable zone containing a point, nearest centre first.
   * Returns null when the location is outside every delivery zone.
   */
  abstract resolveZone(latitude: number, longitude: number): Promise<ZoneMatch | null>;
}
