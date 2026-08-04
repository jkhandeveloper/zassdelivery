import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PriceRange } from '@prisma/client';

export class RestaurantHitDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'Chapli Kabab House' }) name!: string;
  @ApiProperty({ example: 'chapli-kabab-house-pabbi' }) slug!: string;
  @ApiPropertyOptional({ nullable: true }) logoUrl!: string | null;
  @ApiPropertyOptional({ nullable: true }) coverUrl!: string | null;
  @ApiPropertyOptional({ nullable: true }) description!: string | null;
  @ApiProperty({ example: 4.5 }) rating!: number;
  @ApiProperty({ example: 128 }) ratingCount!: number;
  @ApiProperty({ enum: PriceRange }) priceRange!: PriceRange;
  @ApiProperty({ example: 250 }) minOrderAmount!: number;
  @ApiProperty({ example: 25 }) avgPreparationMinutes!: number;
  @ApiProperty({ example: 'Pabbi' }) cityName!: string;
  @ApiProperty({ example: 'Pabbi Central' }) zoneName!: string;
  @ApiProperty({ type: [String], example: ['Desi', 'BBQ'] }) categories!: string[];
  @ApiProperty({ example: true }) isAcceptingOrders!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    example: 820,
    description: 'Metres from the supplied coordinates; null when none were given.',
  })
  distanceMeters!: number | null;

  @ApiProperty({
    example: 0.6687,
    description: 'Full-text rank. Zero when the request carried no search term.',
  })
  relevance!: number;
}

export class FoodHitDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'Chapli Kabab' }) name!: string;
  @ApiPropertyOptional({ nullable: true }) description!: string | null;
  @ApiPropertyOptional({ nullable: true }) imageUrl!: string | null;
  @ApiProperty({ example: 250 }) basePrice!: number;
  @ApiPropertyOptional({ nullable: true }) discountedPrice!: number | null;
  @ApiProperty({ example: 250 }) effectivePrice!: number;
  @ApiProperty({ example: false }) isVegetarian!: boolean;
  @ApiProperty({ example: 'MEDIUM' }) spiceLevel!: string;
  @ApiProperty({ example: 4.6 }) rating!: number;
  @ApiProperty({ example: 42 }) ratingCount!: number;
  @ApiProperty() restaurantId!: string;
  @ApiProperty({ example: 'Chapli Kabab House' }) restaurantName!: string;
  @ApiProperty({ example: 'chapli-kabab-house-pabbi' }) restaurantSlug!: string;
  @ApiProperty({ example: 4.5 }) restaurantRating!: number;
  @ApiPropertyOptional({ nullable: true, example: 820 }) distanceMeters!: number | null;
  @ApiProperty({ example: 0.6687 }) relevance!: number;
}

export class CategoryHitDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'BBQ' }) name!: string;
  @ApiProperty({ example: 'bbq' }) slug!: string;
  @ApiPropertyOptional({ nullable: true }) iconUrl!: string | null;
  @ApiProperty({ example: 2, description: 'Active restaurants in this category.' })
  restaurantCount!: number;
}

export class TrendingHitDto {
  @ApiProperty() restaurantId!: string;
  @ApiProperty({ example: 'Chapli Kabab House' }) name!: string;
  @ApiProperty({ example: 'chapli-kabab-house-pabbi' }) slug!: string;
  @ApiPropertyOptional({ nullable: true }) logoUrl!: string | null;
  @ApiProperty({ example: 4.5 }) rating!: number;
  @ApiProperty({ example: 37, description: 'Delivered orders inside the window.' })
  recentOrders!: number;
}

export class PopularFoodHitDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'Chapli Kabab' }) name!: string;
  @ApiPropertyOptional({ nullable: true }) imageUrl!: string | null;
  @ApiProperty({ example: 250 }) effectivePrice!: number;
  @ApiProperty({ example: 4.6 }) rating!: number;
  @ApiProperty({ example: 42 }) ratingCount!: number;
  @ApiProperty({ example: 'Chapli Kabab House' }) restaurantName!: string;
  @ApiProperty({ example: 'chapli-kabab-house-pabbi' }) restaurantSlug!: string;
  @ApiProperty({ example: 210, description: 'Lifetime order lines for this dish.' })
  orderCount!: number;
}

export class AutocompleteHitDto {
  @ApiProperty({ enum: ['restaurant', 'dish', 'category'] })
  type!: 'restaurant' | 'dish' | 'category';

  @ApiProperty() id!: string;
  @ApiProperty({ example: 'Chapli Kabab House' }) label!: string;

  @ApiProperty({
    example: 'chapli-kabab-house-pabbi',
    description: 'Slug to navigate to. For a dish this is its restaurant’s slug.',
  })
  slug!: string;

  @ApiPropertyOptional({ nullable: true }) imageUrl!: string | null;

  @ApiProperty({
    example: 1,
    description: 'Trigram similarity, 0–1. A prefix match scores 1.',
  })
  score!: number;
}

export class GlobalSearchDto {
  @ApiProperty({ type: [RestaurantHitDto] }) restaurants!: RestaurantHitDto[];
  @ApiProperty({ type: [FoodHitDto] }) dishes!: FoodHitDto[];
  @ApiProperty({ type: [CategoryHitDto] }) categories!: CategoryHitDto[];

  @ApiProperty({
    example: 12,
    description: 'Total matches across all three groups.',
  })
  totalResults!: number;
}
