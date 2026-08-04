import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CartAddOnSelectionDto {
  @ApiProperty({ description: 'Add-on id from the dish’s option groups.' })
  @IsString()
  addOnId!: string;

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  quantity?: number;
}

export class AddCartItemDto {
  @ApiProperty({ description: 'Dish to add.' })
  @IsString()
  menuItemId!: string;

  @ApiPropertyOptional({
    description: 'Chosen variant. Required when the dish has any.',
  })
  @IsOptional()
  @IsString()
  variantId?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 99 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  quantity?: number;

  @ApiPropertyOptional({ example: 'No onions please', maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(trim)
  notes?: string;

  @ApiPropertyOptional({
    type: [CartAddOnSelectionDto],
    description: 'Selected extras. Validated against each group’s min/max rules.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CartAddOnSelectionDto)
  addOns?: CartAddOnSelectionDto[];
}

export class UpdateCartItemDto {
  @ApiProperty({
    description: 'New quantity. Send 0 to remove the line.',
    minimum: 0,
    maximum: 99,
    example: 2,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  quantity!: number;
}

export class ApplyCouponDto {
  @ApiProperty({ example: 'ZASS100', maxLength: 40 })
  @IsString()
  @MaxLength(40)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  code!: string;
}

export class SetCartAddressDto {
  @ApiProperty({ description: 'One of the customer’s saved addresses.' })
  @IsString()
  addressId!: string;
}

export class SetTipDto {
  @ApiProperty({ description: 'Tip in PKR.', example: 50, minimum: 0, maximum: 10000 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10000)
  tipAmount!: number;
}
