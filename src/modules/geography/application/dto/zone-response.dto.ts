import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type { ServiceableZone } from '../../domain/repositories/zone.repository';

export class ZoneCityDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'Pabbi' }) name!: string;
  @ApiPropertyOptional({ nullable: true, example: 'پبی' }) nameUr!: string | null;
  @ApiProperty({ example: 'pabbi' }) slug!: string;
  @ApiProperty({ example: 'Khyber Pakhtunkhwa' }) province!: string;
}

/**
 * A delivery zone as the storefront sees it.
 *
 * The centre and radius are published deliberately: an address is only saved
 * when its coordinates fall inside a zone, so a client that cannot see the
 * shapes can only offer the customer a blind guess and a rejection.
 */
export class ZoneDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'Pabbi Central' }) name!: string;
  @ApiProperty({ example: 'pabbi-central' }) slug!: string;

  @ApiProperty({ example: 34.0086, description: 'Centre of the service circle.' })
  centerLat!: number;
  @ApiProperty({ example: 71.7876 }) centerLng!: number;
  @ApiProperty({ example: 3500, description: 'Service radius from the centre, in metres.' })
  radiusMeters!: number;

  @ApiProperty({ example: 69, description: 'Flat fee, before any distance band applies.' })
  deliveryFee!: number;
  @ApiProperty({ example: 250 }) minOrderAmount!: number;
  @ApiProperty({ example: 30, description: 'Baseline promised delivery time, in minutes.' })
  etaMinutes!: number;

  @ApiProperty({ type: ZoneCityDto }) city!: ZoneCityDto;
}

export function toZoneDto(zone: ServiceableZone): ZoneDto {
  return {
    id: zone.id,
    name: zone.name,
    slug: zone.slug,
    centerLat: zone.centerLat,
    centerLng: zone.centerLng,
    radiusMeters: zone.radiusMeters,
    deliveryFee: zone.deliveryFee,
    minOrderAmount: zone.minOrderAmount,
    etaMinutes: zone.etaMinutes,
    city: zone.city,
  };
}
