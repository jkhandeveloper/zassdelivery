import { Injectable } from '@nestjs/common';
import { SettingValueType } from '@prisma/client';

import {
  BusinessRuleViolationException,
  ResourceConflictException,
  ResourceNotFoundException,
} from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { buildOrderBy } from '@/common/utils/pagination.util';

import {
  BannerRepository,
  CouponRepository,
  SettingRepository,
} from '../../domain/repositories/admin.repository';
import { CouponRules } from '../../domain/services/coupon-rules';
import {
  toBannerDto,
  toCouponDto,
  toSettingDto,
  type BannerDto,
  type CouponDto,
  type SettingDto,
  type SettingGroupDto,
} from '../dto/admin-response.dto';
import {
  COUPON_SORT_FIELDS,
  type CreateBannerDto,
  type CreateCouponDto,
  type ListBannersQueryDto,
  type ListCouponsQueryDto,
  type ReorderBannersDto,
  type UpdateBannerDto,
  type UpdateCouponDto,
  type UpsertSettingsDto,
} from '../dto/admin.dto';

// ── Coupons ────────────────────────────────────────────────────

@Injectable()
export class ListCouponsUseCase {
  constructor(private readonly coupons: CouponRepository) {}

  async execute(
    query: ListCouponsQueryDto,
    scope: { liveOnly?: boolean } = {},
  ): Promise<PaginatedResult<CouponDto>> {
    const orderBy = buildOrderBy(query.sortBy, query.sortOrder, COUPON_SORT_FIELDS, 'createdAt');
    const now = new Date();

    const result = await this.coupons.findMany({
      page: query.page,
      limit: query.limit,
      orderBy,
      search: query.search,
      type: query.type,
      isActive: query.isActive,
      restaurantId: query.restaurantId,
      // The caller-supplied scope wins: the customer-facing list is live-only
      // whatever the query string says.
      liveOnly: scope.liveOnly ?? query.liveOnly,
      now,
    });

    return { items: result.items.map((coupon) => toCouponDto(coupon, now)), meta: result.meta };
  }
}

@Injectable()
export class GetCouponUseCase {
  constructor(private readonly coupons: CouponRepository) {}

  async execute(id: string): Promise<CouponDto> {
    return toCouponDto(await load(this.coupons, id));
  }
}

@Injectable()
export class CreateCouponUseCase {
  constructor(private readonly coupons: CouponRepository) {}

  /**
   * Creates a discount.
   *
   * The shape is validated before it is saved rather than at redemption,
   * because a coupon is the one thing an operator can create that spends money
   * directly — and a malformed one is discovered by customers before it is
   * discovered by finance.
   */
  async execute(dto: CreateCouponDto, actor: AuthenticatedUser): Promise<CouponDto> {
    if (await this.coupons.findByCode(dto.code)) {
      throw new ResourceConflictException(`A coupon with the code ${dto.code} already exists.`);
    }

    CouponRules.assertValid({
      type: dto.type,
      value: dto.value,
      maxDiscountAmount: dto.maxDiscountAmount,
      minOrderAmount: dto.minOrderAmount,
      startsAt: dto.startsAt,
      expiresAt: dto.expiresAt,
      usageLimit: dto.usageLimit,
      perUserLimit: dto.perUserLimit,
    });

    const coupon = await this.coupons.create({
      code: dto.code,
      type: dto.type,
      value: dto.value,
      maxDiscountAmount: dto.maxDiscountAmount ?? null,
      minOrderAmount: dto.minOrderAmount ?? 0,
      description: dto.description ?? null,
      startsAt: dto.startsAt,
      expiresAt: dto.expiresAt,
      usageLimit: dto.usageLimit ?? null,
      perUserLimit: dto.perUserLimit ?? null,
      restaurantId: dto.restaurantId ?? null,
      zoneId: dto.zoneId ?? null,
      firstOrderOnly: dto.firstOrderOnly ?? false,
      isActive: dto.isActive ?? true,
      createdById: actor.id,
    });

    return toCouponDto(coupon);
  }
}

@Injectable()
export class UpdateCouponUseCase {
  constructor(private readonly coupons: CouponRepository) {}

  async execute(id: string, dto: UpdateCouponDto): Promise<CouponDto> {
    const existing = await load(this.coupons, id);
    const redemptions = await this.coupons.redemptionCount(id);

    // The code is the thing customers were told. Changing it after somebody has
    // used it rewrites what happened on their order.
    if (dto.code !== undefined && dto.code !== existing.code && redemptions > 0) {
      throw new BusinessRuleViolationException(
        'This coupon has already been redeemed, so its code cannot be changed. Create a new one instead.',
      );
    }

    const merged = {
      type: dto.type ?? existing.type,
      value: dto.value ?? Number(existing.value),
      maxDiscountAmount:
        dto.maxDiscountAmount ??
        (existing.maxDiscountAmount === null ? null : Number(existing.maxDiscountAmount)),
      minOrderAmount: dto.minOrderAmount ?? Number(existing.minOrderAmount),
      startsAt: dto.startsAt ?? existing.startsAt,
      expiresAt: dto.expiresAt ?? existing.expiresAt,
      usageLimit: dto.usageLimit ?? existing.usageLimit,
      perUserLimit: dto.perUserLimit ?? existing.perUserLimit,
    };

    // Validated against the merged result, not the patch: a change that is
    // harmless on its own can still produce an incoherent coupon.
    CouponRules.assertValid(merged);

    if (merged.usageLimit !== null && merged.usageLimit < existing.usageCount) {
      throw new BusinessRuleViolationException(
        `This coupon has already been used ${existing.usageCount} times, so the limit cannot be lowered below that.`,
      );
    }

    const updated = await this.coupons.update(id, {
      ...(dto.code !== undefined && { code: dto.code }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.restaurantId !== undefined && { restaurantId: dto.restaurantId }),
      ...(dto.zoneId !== undefined && { zoneId: dto.zoneId }),
      ...(dto.firstOrderOnly !== undefined && { firstOrderOnly: dto.firstOrderOnly }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      ...merged,
    });

    return toCouponDto(updated);
  }
}

@Injectable()
export class SetCouponActiveUseCase {
  constructor(private readonly coupons: CouponRepository) {}

  /** The kill switch — how a campaign is stopped without losing its history. */
  async execute(id: string, isActive: boolean): Promise<CouponDto> {
    await load(this.coupons, id);

    return toCouponDto(await this.coupons.setActive(id, isActive));
  }
}

@Injectable()
export class DeleteCouponUseCase {
  constructor(private readonly coupons: CouponRepository) {}

  /**
   * Removes a coupon nobody has used.
   *
   * A redeemed one is deactivated instead: orders reference it, and deleting it
   * would rewrite the discount out of a customer's receipt.
   */
  async execute(id: string): Promise<{ message: string }> {
    await load(this.coupons, id);
    const redemptions = await this.coupons.redemptionCount(id);

    if (redemptions > 0) {
      throw new BusinessRuleViolationException(
        `This coupon has been redeemed ${redemptions} time(s) and is part of those orders. Deactivate it instead of deleting it.`,
      );
    }

    await this.coupons.delete(id);

    return { message: 'Coupon deleted.' };
  }
}

// ── Banners ────────────────────────────────────────────────────

@Injectable()
export class ListBannersUseCase {
  constructor(private readonly banners: BannerRepository) {}

  async execute(
    query: ListBannersQueryDto,
    scope: { liveOnly?: boolean } = {},
  ): Promise<PaginatedResult<BannerDto>> {
    const now = new Date();

    const result = await this.banners.findMany({
      page: query.page,
      limit: query.limit,
      placement: query.placement,
      cityId: query.cityId,
      isActive: query.isActive,
      liveOnly: scope.liveOnly,
      now,
    });

    return { items: result.items.map((banner) => toBannerDto(banner, now)), meta: result.meta };
  }
}

@Injectable()
export class CreateBannerUseCase {
  constructor(private readonly banners: BannerRepository) {}

  async execute(dto: CreateBannerDto): Promise<BannerDto> {
    assertWindow(dto.startsAt, dto.endsAt);

    const banner = await this.banners.create({
      title: dto.title,
      subtitle: dto.subtitle ?? null,
      imageUrl: dto.imageUrl,
      placement: dto.placement,
      restaurantId: dto.restaurantId ?? null,
      linkUrl: dto.linkUrl ?? null,
      cityId: dto.cityId ?? null,
      sortOrder: dto.sortOrder ?? 0,
      startsAt: dto.startsAt ?? null,
      endsAt: dto.endsAt ?? null,
      isActive: dto.isActive ?? true,
    });

    return toBannerDto(banner);
  }
}

@Injectable()
export class UpdateBannerUseCase {
  constructor(private readonly banners: BannerRepository) {}

  async execute(id: string, dto: UpdateBannerDto): Promise<BannerDto> {
    const existing = await this.banners.findById(id);

    if (!existing) {
      throw new ResourceNotFoundException('Banner', id);
    }

    assertWindow(dto.startsAt ?? existing.startsAt, dto.endsAt ?? existing.endsAt);

    const updated = await this.banners.update(id, {
      ...(dto.title !== undefined && { title: dto.title }),
      ...(dto.subtitle !== undefined && { subtitle: dto.subtitle }),
      ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
      ...(dto.placement !== undefined && { placement: dto.placement }),
      ...(dto.restaurantId !== undefined && { restaurantId: dto.restaurantId }),
      ...(dto.linkUrl !== undefined && { linkUrl: dto.linkUrl }),
      ...(dto.cityId !== undefined && { cityId: dto.cityId }),
      ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      ...(dto.startsAt !== undefined && { startsAt: dto.startsAt }),
      ...(dto.endsAt !== undefined && { endsAt: dto.endsAt }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    });

    return toBannerDto(updated);
  }
}

@Injectable()
export class DeleteBannerUseCase {
  constructor(private readonly banners: BannerRepository) {}

  async execute(id: string): Promise<{ message: string }> {
    if (!(await this.banners.findById(id))) {
      throw new ResourceNotFoundException('Banner', id);
    }

    await this.banners.delete(id);

    return { message: 'Banner deleted.' };
  }
}

@Injectable()
export class ReorderBannersUseCase {
  constructor(private readonly banners: BannerRepository) {}

  /** Applies a new carousel order in one transaction. */
  async execute(dto: ReorderBannersDto): Promise<BannerDto[]> {
    const ids = dto.banners.map((entry) => entry.id);

    if (new Set(ids).size !== ids.length) {
      throw new BusinessRuleViolationException('A banner appears twice in the requested order.');
    }

    const banners = await this.banners.reorder(dto.banners);

    return banners.map((banner) => toBannerDto(banner));
  }
}

// ── Settings ───────────────────────────────────────────────────

@Injectable()
export class ListSettingsUseCase {
  constructor(private readonly settings: SettingRepository) {}

  /**
   * Settings, grouped the way the screen shows them.
   *
   * `publicOnly` is the switch that keeps private configuration inside the API:
   * the customer-facing route always passes it, whatever the query string says.
   */
  async execute(options: { group?: string; publicOnly?: boolean }): Promise<SettingGroupDto[]> {
    const settings = await this.settings.findMany(options);
    const groups = new Map<string, SettingDto[]>();

    for (const setting of settings) {
      const bucket = groups.get(setting.group) ?? [];
      bucket.push(toSettingDto(setting));
      groups.set(setting.group, bucket);
    }

    return [...groups.entries()].map(([group, entries]) => ({ group, settings: entries }));
  }

  async flat(options: { group?: string; publicOnly?: boolean }): Promise<SettingDto[]> {
    const settings = await this.settings.findMany(options);

    return settings.map(toSettingDto);
  }
}

@Injectable()
export class UpsertSettingsUseCase {
  constructor(private readonly settings: SettingRepository) {}

  /**
   * Writes a batch of settings.
   *
   * All or nothing, because related settings are meaningless apart — a
   * quiet-hours start applied without its end is a window nobody configured.
   * Each value is checked against its declared type first, so a number setting
   * cannot be saved as the word "five" and discovered by the pricing engine.
   */
  async execute(dto: UpsertSettingsDto, actor: AuthenticatedUser): Promise<SettingDto[]> {
    for (const setting of dto.settings) {
      assertValueMatchesType(
        setting.key,
        setting.value,
        setting.valueType ?? SettingValueType.STRING,
      );
    }

    const saved = await this.settings.upsertMany(
      dto.settings.map((setting) => ({
        key: setting.key,
        value: setting.value,
        valueType: setting.valueType ?? SettingValueType.STRING,
        group: setting.group ?? setting.key.split('.')[0] ?? 'general',
        description: setting.description ?? null,
        isPublic: setting.isPublic ?? false,
        updatedById: actor.id,
      })),
    );

    return saved.map(toSettingDto);
  }
}

@Injectable()
export class DeleteSettingUseCase {
  constructor(private readonly settings: SettingRepository) {}

  async execute(key: string): Promise<{ message: string }> {
    if (!(await this.settings.findByKey(key))) {
      throw new ResourceNotFoundException('Setting', key);
    }

    await this.settings.delete(key);

    return { message: `Setting ${key} deleted. The application default now applies.` };
  }
}

// ── Helpers ────────────────────────────────────────────────────

async function load(coupons: CouponRepository, id: string) {
  const coupon = await coupons.findById(id);

  if (!coupon) {
    throw new ResourceNotFoundException('Coupon', id);
  }

  return coupon;
}

function assertWindow(startsAt: Date | null | undefined, endsAt: Date | null | undefined): void {
  if (
    startsAt !== null &&
    startsAt !== undefined &&
    endsAt !== null &&
    endsAt !== undefined &&
    endsAt <= startsAt
  ) {
    throw new BusinessRuleViolationException('A banner must stop showing after it starts.');
  }
}

/**
 * A setting must parse as what it says it is.
 *
 * Checked here rather than trusted, because the failure otherwise surfaces
 * wherever the value is read — a pricing engine turning `"five"` into `NaN`
 * silently charges every customer nothing.
 */
function assertValueMatchesType(key: string, value: string, type: SettingValueType): void {
  if (type === SettingValueType.NUMBER && !Number.isFinite(Number(value))) {
    throw new BusinessRuleViolationException(`${key} is a NUMBER setting, but "${value}" is not.`);
  }

  if (type === SettingValueType.BOOLEAN && !['true', 'false', '1', '0'].includes(value)) {
    throw new BusinessRuleViolationException(
      `${key} is a BOOLEAN setting, so it must be "true" or "false".`,
    );
  }

  if (type === SettingValueType.JSON) {
    try {
      JSON.parse(value);
    } catch {
      throw new BusinessRuleViolationException(
        `${key} is a JSON setting, but the value is not valid JSON.`,
      );
    }
  }
}
