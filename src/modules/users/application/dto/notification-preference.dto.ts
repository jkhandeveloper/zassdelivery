import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  ValidateNested,
} from 'class-validator';

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

export class NotificationChannelsDto {
  @ApiPropertyOptional({ description: 'Show in the in-app notification centre.', default: true })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  inApp?: boolean;

  @ApiPropertyOptional({ description: 'Send a push notification to the device.', default: true })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  push?: boolean;

  @ApiPropertyOptional({
    description: 'Send an SMS. Off by default because each message has a cost.',
    default: false,
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  sms?: boolean;

  @ApiPropertyOptional({ description: 'Send an email.', default: false })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  email?: boolean;
}

export class NotificationPreferenceEntryDto extends NotificationChannelsDto {
  @ApiProperty({ enum: NotificationType, example: NotificationType.ORDER_UPDATE })
  @IsEnum(NotificationType)
  type!: NotificationType;
}

export class UpdateNotificationPreferencesDto {
  @ApiProperty({
    type: [NotificationPreferenceEntryDto],
    description:
      'Categories to update. Categories omitted here are left untouched, so a ' +
      'client can send a single toggle without having to echo the whole set back.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => NotificationPreferenceEntryDto)
  preferences!: NotificationPreferenceEntryDto[];
}

export class NotificationPreferenceDto {
  @ApiProperty({ enum: NotificationType })
  type!: NotificationType;

  @ApiProperty({ example: true })
  inApp!: boolean;

  @ApiProperty({ example: true })
  push!: boolean;

  @ApiProperty({ example: false })
  sms!: boolean;

  @ApiProperty({ example: false })
  email!: boolean;

  @ApiProperty({
    example: false,
    description: 'False when the user has never customised this category.',
  })
  isCustomised!: boolean;
}
