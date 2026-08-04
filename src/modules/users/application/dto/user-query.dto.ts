import { ApiPropertyOptional } from '@nestjs/swagger';
import { AddressLabel, UserRole, UserStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDate, IsEnum, IsIn, IsOptional } from 'class-validator';

import { PaginationQueryDto } from '@/common/dto/pagination-query.dto';

const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return value;
};

/**
 * Sortable columns for the user list.
 *
 * Exposed as an explicit list rather than accepting any column name: every one
 * of these is index-backed, and an open-ended sort would let a caller order by
 * an unindexed column and turn a listing into a full table scan.
 */
export const USER_SORT_FIELDS = ['createdAt', 'updatedAt', 'fullName', 'lastLoginAt'] as const;
export type UserSortField = (typeof USER_SORT_FIELDS)[number];

export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Matches against full name and phone number (case-insensitive, partial).',
    example: 'ahmad',
  })
  declare search?: string;

  @ApiPropertyOptional({ enum: USER_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(USER_SORT_FIELDS, {
    message: `sortBy must be one of: ${USER_SORT_FIELDS.join(', ')}`,
  })
  declare sortBy?: UserSortField;

  @ApiPropertyOptional({ enum: UserRole, description: 'Filter by primary role.' })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ enum: UserStatus, description: 'Filter by account status.' })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({
    description: 'Include soft-deleted accounts. Administrative use only.',
    default: false,
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  includeDeleted?: boolean;

  @ApiPropertyOptional({
    description: 'Only accounts created on or after this instant (ISO 8601).',
    example: '2026-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'createdFrom must be a valid ISO 8601 date' })
  createdFrom?: Date;

  @ApiPropertyOptional({
    description: 'Only accounts created on or before this instant (ISO 8601).',
    example: '2026-12-31T23:59:59.999Z',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'createdTo must be a valid ISO 8601 date' })
  createdTo?: Date;
}

export const ADDRESS_SORT_FIELDS = ['createdAt', 'updatedAt', 'label'] as const;
export type AddressSortField = (typeof ADDRESS_SORT_FIELDS)[number];

export class ListAddressesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Matches address line and landmark.' })
  declare search?: string;

  @ApiPropertyOptional({ enum: ADDRESS_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(ADDRESS_SORT_FIELDS, {
    message: `sortBy must be one of: ${ADDRESS_SORT_FIELDS.join(', ')}`,
  })
  declare sortBy?: AddressSortField;

  @ApiPropertyOptional({ enum: AddressLabel })
  @IsOptional()
  @IsEnum(AddressLabel)
  label?: AddressLabel;
}

export const FAVORITE_SORT_FIELDS = ['createdAt'] as const;

export class ListFavoritesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: FAVORITE_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(FAVORITE_SORT_FIELDS)
  declare sortBy?: 'createdAt';

  @ApiPropertyOptional({
    description: 'Restrict to one kind of favorite.',
    enum: ['restaurant', 'menuItem'],
  })
  @IsOptional()
  @IsIn(['restaurant', 'menuItem'])
  target?: 'restaurant' | 'menuItem';
}
