import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, ValidateIf } from 'class-validator';

/**
 * Exactly one target must be supplied. A database CHECK constraint enforces the
 * same rule, so a malformed write cannot slip past through another code path.
 */
export class CreateFavoriteDto {
  @ApiPropertyOptional({
    description: 'Restaurant to favorite. Provide this or menuItemId, not both.',
    example: 'clx8f2k9a0000zo79b1h2c3d4',
  })
  @ValidateIf((dto: CreateFavoriteDto) => !dto.menuItemId)
  @IsString({ message: 'either restaurantId or menuItemId is required' })
  restaurantId?: string;

  @ApiPropertyOptional({
    description: 'Menu item to favorite. Provide this or restaurantId, not both.',
    example: 'clx8f2k9a0001zo79b1h2c3d5',
  })
  @IsOptional()
  @IsString()
  menuItemId?: string;
}

export class FavoriteTargetDto {
  @ApiProperty({ example: 'clx8f2k9a0000zo79b1h2c3d4' })
  id!: string;

  @ApiProperty({ example: 'Chapli Kabab House' })
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  imageUrl!: string | null;
}

export class FavoriteDto {
  @ApiProperty({ example: 'clx8f2k9a0002zo79b1h2c3d6' })
  id!: string;

  @ApiProperty({ enum: ['restaurant', 'menuItem'], example: 'restaurant' })
  target!: 'restaurant' | 'menuItem';

  @ApiProperty({ type: FavoriteTargetDto })
  item!: FavoriteTargetDto;

  @ApiProperty({ example: '2026-08-04T09:12:33.412Z' })
  createdAt!: Date;
}
