import { Body, Controller, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Public } from '@/common/decorators/public.decorator';
import { SkipResponseWrap } from '@/common/decorators/skip-response-wrap.decorator';

import { HandleWebhookUseCase, type WebhookAck } from './application/use-cases/webhook.use-cases';

/**
 * Where the payment gateways report back.
 *
 * Public by necessity — a gateway has no bearer token — so nothing here trusts
 * the caller. Authentication is the payload's own signature, checked by the
 * adapter for that provider, and a callback that fails it changes nothing.
 *
 * These routes answer 200 for anything they have safely recorded, including
 * duplicates. That is not politeness: a gateway that does not hear a clean
 * acknowledgement redelivers, escalates, and eventually disables the endpoint,
 * so "I already knew that" must not look like a failure. The genuine failures —
 * an unverifiable signature, an unknown reference — are reported in the body
 * and land in the webhook log for an operator.
 */
@ApiTags('Payment Webhooks')
@Controller('payment-webhooks')
export class PaymentWebhooksController {
  constructor(private readonly handle: HandleWebhookUseCase) {}

  @Post('jazzcash')
  @Public()
  @SkipResponseWrap()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'JazzCash payment callback',
    description:
      'Registered with JazzCash as `pp_ReturnURL`. Verified against the HMAC ' +
      'in `pp_SecureHash`; a mismatch is recorded and ignored. Redelivery is ' +
      'free — the callback is deduplicated on the gateway’s own event id.',
  })
  @ApiResponse({ status: 200, description: 'Recorded. The body reports what was done with it.' })
  jazzcash(
    @Body() body: Record<string, unknown>,
    @Query() query: Record<string, unknown>,
  ): Promise<WebhookAck> {
    // JazzCash posts form fields, but sends the customer's browser back with a
    // query string. Merging covers both without a second endpoint that would
    // drift from this one.
    return this.handle.execute('jazzcash', { ...query, ...body });
  }

  @Post('easypaisa')
  @Public()
  @SkipResponseWrap()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Easypaisa payment callback',
    description:
      'Registered with Easypaisa as `postBackURL`. Easypay does not sign its ' +
      'return, so nothing settles on this payload alone: the outcome is ' +
      'confirmed with Easypaisa directly before any money moves.',
  })
  @ApiResponse({ status: 200, description: 'Recorded. The body reports what was done with it.' })
  easypaisa(
    @Body() body: Record<string, unknown>,
    @Query() query: Record<string, unknown>,
  ): Promise<WebhookAck> {
    return this.handle.execute('easypaisa', { ...query, ...body });
  }

  @Post(':gateway')
  @Public()
  @SkipResponseWrap()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  @ApiParam({ name: 'gateway' })
  catchAll(
    @Param('gateway') gateway: string,
    @Body() body: Record<string, unknown>,
    @Query() query: Record<string, unknown>,
  ): Promise<WebhookAck> {
    // A provider configured with the wrong path still gets a definite answer,
    // and the attempt is visible in the webhook log rather than lost in an
    // access log as a 404.
    return this.handle.execute(gateway, { ...query, ...body });
  }
}
