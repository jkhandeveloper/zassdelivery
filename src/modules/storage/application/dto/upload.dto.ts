import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

import { UploadFolder } from '../../domain/upload.constants';

export class UploadFileDto {
  @ApiProperty({
    enum: UploadFolder,
    description: 'What the file is for. Decides where in the bucket it is filed.',
    example: UploadFolder.RiderDocuments,
  })
  @IsEnum(UploadFolder)
  folder!: UploadFolder;
}

export class UploadedFileDto {
  @ApiProperty({
    example: 'http://localhost:3000/api/v1/uploads/rider-documents/9f1c…-a3.jpg',
    description:
      'Where the file can be read back. Send this as `fileUrl` on whatever record the file belongs to.',
  })
  url!: string;

  @ApiProperty({
    example: 'rider-documents/9f1c2b4e-7a10-4d9c-bb31-5c0e3f0a12a3.jpg',
    description: 'The object key inside the bucket.',
  })
  key!: string;

  @ApiProperty({ enum: UploadFolder })
  folder!: UploadFolder;

  @ApiPropertyOptional({
    example: 'cnic-front.jpg',
    description: 'The name the file had on the uploader’s device, where the browser sent one.',
    nullable: true,
  })
  fileName!: string | null;

  @ApiProperty({ example: 'image/jpeg' })
  mimeType!: string;

  @ApiProperty({ example: 248_310, description: 'Size in bytes.' })
  size!: number;
}
