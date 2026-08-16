import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AddressLabel, UserRole, UserStatus, type Address, type User } from '@prisma/client';

export class UserDto {
  @ApiProperty({ example: 'clx8f2k9a0000zo79b1h2c3d4' })
  id!: string;

  @ApiProperty({ example: '+923001234567' })
  phone!: string;

  @ApiProperty({ example: 'Ahmad Khan' })
  fullName!: string;

  @ApiPropertyOptional({ example: 'ahmad@example.com', nullable: true })
  email!: string | null;

  @ApiPropertyOptional({ nullable: true })
  avatarUrl!: string | null;

  @ApiProperty({ example: 'en' })
  locale!: string;

  @ApiProperty({ enum: UserRole })
  role!: UserRole;

  @ApiProperty({ enum: UserStatus })
  status!: UserStatus;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Set only for VENDOR_STAFF: the restaurant this account works for.',
  })
  staffRestaurantId?: string | null;

  @ApiProperty({ example: true })
  isPhoneVerified!: boolean;

  @ApiPropertyOptional({ nullable: true, example: '2026-08-04T09:12:33.412Z' })
  lastLoginAt!: Date | null;

  @ApiProperty({ example: '2026-08-04T09:12:33.412Z' })
  createdAt!: Date;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Set when the account is soft-deleted. Visible to administrators only.',
  })
  deletedAt?: Date | null;
}

export class AddressDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: AddressLabel })
  label!: AddressLabel;

  @ApiProperty({ example: 'House 14, Street 3, Gulshan Colony' })
  line1!: string;

  @ApiPropertyOptional({ nullable: true })
  line2!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Near Pabbi Bus Stand' })
  landmark!: string | null;

  @ApiProperty({ example: 'clx8f2k9a0003zo79b1h2c3d7' })
  cityId!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Resolved from the coordinates. Null means outside every delivery zone.',
  })
  zoneId!: string | null;

  @ApiProperty({ example: 34.0091 })
  latitude!: number;

  @ApiProperty({ example: 71.7869 })
  longitude!: number;

  @ApiPropertyOptional({ nullable: true })
  recipientName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  recipientPhone!: string | null;

  @ApiPropertyOptional({ nullable: true })
  deliveryNotes!: string | null;

  @ApiProperty({ example: true })
  isDefault!: boolean;

  @ApiProperty({
    example: true,
    description: 'False when the address falls outside every serviceable zone.',
  })
  isDeliverable!: boolean;

  @ApiProperty()
  createdAt!: Date;
}

/**
 * Projects a user row onto the public shape.
 *
 * An explicit allow-list rather than a spread: `passwordHash` and `pushToken`
 * live on the same row, and a column added later must not leak simply because
 * nobody remembered to exclude it.
 */
export function toUserDto(user: User, includeDeletedAt = false): UserDto {
  const dto: UserDto = {
    id: user.id,
    phone: user.phone,
    fullName: user.fullName,
    email: user.email,
    avatarUrl: user.avatarUrl,
    locale: user.locale,
    role: user.role,
    status: user.status,
    staffRestaurantId: user.staffRestaurantId,
    isPhoneVerified: user.phoneVerifiedAt !== null,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };

  if (includeDeletedAt) {
    dto.deletedAt = user.deletedAt;
  }

  return dto;
}

export function toAddressDto(address: Address): AddressDto {
  return {
    id: address.id,
    label: address.label,
    line1: address.line1,
    line2: address.line2,
    landmark: address.landmark,
    cityId: address.cityId,
    zoneId: address.zoneId,
    latitude: address.latitude,
    longitude: address.longitude,
    recipientName: address.recipientName,
    recipientPhone: address.recipientPhone,
    deliveryNotes: address.deliveryNotes,
    isDefault: address.isDefault,
    // A saved address outside every zone is kept but cannot be ordered to;
    // surfacing that here saves the client discovering it at checkout.
    isDeliverable: address.zoneId !== null,
    createdAt: address.createdAt,
  };
}
