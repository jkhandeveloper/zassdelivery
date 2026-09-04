import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';

import { ApiErrorResponseDto } from '@/common/dto/api-response.dto';
import { Public } from '@/common/decorators/public.decorator';
import { RequestTimeout } from '@/common/decorators/request-timeout.decorator';
import { SkipResponseWrap } from '@/common/decorators/skip-response-wrap.decorator';

import { UploadFileDto, UploadedFileDto } from './application/dto/upload.dto';
import { DownloadFileUseCase, UploadFileUseCase } from './application/use-cases/upload.use-cases';

/**
 * One way in and one way out for every user-supplied file.
 *
 * Uploading and *using* a file are deliberately separate steps: the client
 * posts the file here, gets a URL back, and sends that URL on the record it
 * belongs to — a rider document, a restaurant logo. That keeps every existing
 * endpoint taking plain JSON, and lets one implementation serve all of them.
 *
 * Reading back is unauthenticated by design. Object names are random UUIDs, so
 * a URL is unguessable and acts as the capability itself — which is what makes
 * a document open in a new tab, or render in an `<img>`, without the browser
 * having to attach a bearer token it cannot attach.
 */
@ApiTags('Uploads')
@Controller('uploads')
export class UploadsController {
  constructor(
    private readonly uploadFile: UploadFileUseCase,
    private readonly downloadFile: DownloadFileUseCase,
  ) {}

  @Post()
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Upload a file',
    description:
      'Stores one file and returns the URL to read it back. Send the returned `url` as the ' +
      '`fileUrl` of whatever record the file belongs to. JPG, PNG, WebP, HEIC and PDF only.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'folder'],
      properties: {
        file: { type: 'string', format: 'binary' },
        folder: {
          type: 'string',
          enum: [
            'rider-documents',
            'restaurant-logos',
            'restaurant-gallery',
            'menu-items',
            'avatars',
            'support-attachments',
          ],
        },
      },
    },
  })
  @ApiResponse({ status: 201, type: UploadedFileDto })
  @ApiResponse({
    status: 400,
    description: 'Missing, empty or unsupported file',
    type: ApiErrorResponseDto,
  })
  @ApiResponse({
    status: 413,
    description: 'Larger than the size limit',
    type: ApiErrorResponseDto,
  })
  @ApiResponse({
    status: 503,
    description: 'Object storage is not configured',
    type: ApiErrorResponseDto,
  })
  // A phone on a weak connection needs far longer than a database-bound route.
  @RequestTimeout(120_000)
  // Enough for a rider filing a full set of documents, not enough to fill a bucket.
  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: UploadFileDto,
  ): Promise<UploadedFileDto> {
    return this.uploadFile.execute({ folder: body.folder, file: requireFile(file) });
  }

  @Get(':folder/:name')
  @Public()
  @SkipResponseWrap()
  @ApiOperation({
    summary: 'Read an uploaded file',
    description:
      'Streams the stored object. Public: the random object name is the capability, so the ' +
      'URL can be opened in a tab or used as an image source directly.',
  })
  @ApiParam({ name: 'folder', example: 'rider-documents' })
  @ApiParam({ name: 'name', example: '9f1c2b4e-7a10-4d9c-bb31-5c0e3f0a12a3.jpg' })
  @ApiResponse({ status: 200, description: 'The file' })
  @ApiResponse({ status: 404, description: 'No such file', type: ApiErrorResponseDto })
  async download(
    @Param('folder') folder: string,
    @Param('name') name: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.downloadFile.execute({ folder, name });

    response.set({
      'Content-Type': file.mimeType,
      'Content-Length': String(file.size),
      // `inline` so a document opens in the tab; the name is re-encoded rather
      // than interpolated, so it cannot break out of the header.
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.fileName ?? name)}`,
      // The type is ours, taken from an allow-list at upload — never sniffed.
      'X-Content-Type-Options': 'nosniff',
      // Helmet defaults every response to `same-origin`, which is right for the
      // JSON API but silently breaks this route: the web app runs on its own
      // origin, so an `<img>` pointed here is a cross-origin subresource and the
      // browser drops it without an error anyone can see. These objects are
      // meant to be embedded — the unguessable name is the capability, not the
      // origin — so this one route opts out.
      'Cross-Origin-Resource-Policy': 'cross-origin',
      // An unguessable URL is only unguessable while it stays out of an index.
      'X-Robots-Tag': 'noindex, nofollow',
      'Cache-Control': 'private, max-age=3600',
    });

    return new StreamableFile(file.stream);
  }
}

/**
 * A missing part is a client mistake, but multer reports it as `undefined`
 * rather than an error, so it is turned into one here.
 */
function requireFile(file: Express.Multer.File | undefined): Express.Multer.File {
  if (file === undefined) {
    throw new BadRequestException('No file was sent. Attach it as the `file` part.');
  }

  return file;
}
