import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { EARTH_RADIUS_METRES } from '@/common/constants/app.constants';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { paginate } from '@/common/utils/pagination.util';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import {
  SearchRepository,
  type AutocompleteHit,
  type CategoryHit,
  type FoodSearchFilter,
  type FoodSearchHit,
  type GeoPoint,
  type PopularFoodHit,
  type RestaurantSearchFilter,
  type RestaurantSearchHit,
  type TrendingHit,
} from '../../domain/repositories/search.repository';

/**
 * Haversine distance as a SQL fragment, in metres.
 *
 * Composed with `Prisma.sql` so the coordinates remain bound parameters — they
 * arrive from the query string and must never be interpolated as text.
 */
function distanceSql(point: GeoPoint, latColumn: Prisma.Sql, lngColumn: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(${EARTH_RADIUS_METRES} * 2 * ASIN(SQRT(
    POWER(SIN(RADIANS(${point.latitude}::double precision - ${latColumn}) / 2), 2) +
    COS(RADIANS(${latColumn})) * COS(RADIANS(${point.latitude}::double precision)) *
    POWER(SIN(RADIANS(${point.longitude}::double precision - ${lngColumn}) / 2), 2)
  )))`;
}

/** Rows come back from raw SQL with snake_case keys and string numerics. */
interface RestaurantRow {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  cover_url: string | null;
  description: string | null;
  rating: string;
  rating_count: number;
  price_range: string;
  min_order_amount: string;
  avg_preparation_minutes: number;
  city_name: string;
  zone_name: string;
  categories: string[] | null;
  is_accepting_orders: boolean;
  distance_meters: number | null;
  relevance: number;
  total_count: bigint;
}

interface FoodRow {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  base_price: string;
  discounted_price: string | null;
  is_vegetarian: boolean;
  spice_level: string;
  rating: string;
  rating_count: number;
  restaurant_id: string;
  restaurant_name: string;
  restaurant_slug: string;
  restaurant_rating: string;
  distance_meters: number | null;
  relevance: number;
  total_count: bigint;
}

@Injectable()
export class PrismaSearchRepository extends SearchRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async searchRestaurants(
    filter: RestaurantSearchFilter,
  ): Promise<PaginatedResult<RestaurantSearchHit>> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`r.deleted_at IS NULL`,
      Prisma.sql`r.status = 'ACTIVE'`,
    ];

    // `websearch_to_tsquery` accepts what a user actually types — quoted
    // phrases, OR, leading minus — and never throws on malformed input, unlike
    // `to_tsquery`, which would turn a stray operator into a 500.
    const hasTerm = filter.term !== undefined && filter.term.trim().length > 0;
    const tsquery = hasTerm
      ? Prisma.sql`websearch_to_tsquery('simple', ${filter.term})`
      : Prisma.sql`NULL`;

    if (hasTerm) {
      conditions.push(Prisma.sql`r.search_vector @@ ${tsquery}`);
    }

    if (filter.cityId) {
      conditions.push(Prisma.sql`r.city_id = ${filter.cityId}`);
    }

    if (filter.zoneId) {
      conditions.push(Prisma.sql`r.zone_id = ${filter.zoneId}`);
    }

    if (filter.priceRange) {
      conditions.push(Prisma.sql`r.price_range = ${filter.priceRange}::price_range`);
    }

    if (filter.minRating !== undefined) {
      conditions.push(Prisma.sql`r.rating >= ${filter.minRating}`);
    }

    if (filter.openNowOnly === true) {
      conditions.push(Prisma.sql`r.is_accepting_orders = true`);
    }

    if (filter.categorySlug) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM restaurant_category_assignments rca
        JOIN restaurant_categories rc ON rc.id = rca.category_id
        WHERE rca.restaurant_id = r.id AND rc.slug = ${filter.categorySlug}
      )`);
    }

    const distance = filter.near
      ? distanceSql(filter.near, Prisma.sql`r.latitude`, Prisma.sql`r.longitude`)
      : Prisma.sql`NULL::double precision`;

    if (filter.near) {
      // The effective radius is the tighter of what the caller asked for and
      // what the restaurant is willing to deliver — a restaurant outside its
      // own radius cannot serve this address whatever the customer requested.
      const requested = filter.radiusMeters ?? 15000;
      conditions.push(Prisma.sql`${distance} <= LEAST(${requested}, r.delivery_radius_meters)`);
    }

    const relevance = hasTerm
      ? Prisma.sql`ts_rank(r.search_vector, ${tsquery})`
      : Prisma.sql`0::real`;

    const orderBy = this.restaurantOrder(filter, hasTerm, distance, relevance);
    const offset = (filter.page - 1) * filter.limit;

    // COUNT(*) OVER () returns the unpaginated total in the same pass, which
    // avoids issuing this fairly expensive query twice just to paginate it.
    const rows = await this.prisma.$queryRaw<RestaurantRow[]>`
      SELECT
        r.id, r.name, r.slug, r.logo_url, r.cover_url, r.description,
        r.rating, r.rating_count, r.price_range::text AS price_range,
        r.min_order_amount, r.avg_preparation_minutes, r.is_accepting_orders,
        c.name AS city_name,
        z.name AS zone_name,
        ARRAY(
          SELECT rc.name FROM restaurant_category_assignments rca
          JOIN restaurant_categories rc ON rc.id = rca.category_id
          WHERE rca.restaurant_id = r.id
        ) AS categories,
        ${distance} AS distance_meters,
        ${relevance} AS relevance,
        COUNT(*) OVER () AS total_count
      FROM restaurants r
      JOIN cities c ON c.id = r.city_id
      JOIN zones z ON z.id = r.zone_id
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY ${orderBy}
      LIMIT ${filter.limit} OFFSET ${offset}
    `;

    const total = rows.length > 0 ? Number(rows[0]?.total_count ?? 0) : 0;

    return paginate(rows.map(toRestaurantHit), total, filter.page, filter.limit);
  }

  async searchFood(filter: FoodSearchFilter): Promise<PaginatedResult<FoodSearchHit>> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`mi.deleted_at IS NULL`,
      Prisma.sql`mi.status = 'AVAILABLE'`,
      // A dish is only orderable if its restaurant is live, so the join is
      // filtered rather than left open.
      Prisma.sql`r.deleted_at IS NULL`,
      Prisma.sql`r.status = 'ACTIVE'`,
    ];

    const hasTerm = filter.term !== undefined && filter.term.trim().length > 0;
    const tsquery = hasTerm
      ? Prisma.sql`websearch_to_tsquery('simple', ${filter.term})`
      : Prisma.sql`NULL`;

    if (hasTerm) {
      conditions.push(Prisma.sql`mi.search_vector @@ ${tsquery}`);
    }

    if (filter.restaurantId) {
      conditions.push(Prisma.sql`mi.restaurant_id = ${filter.restaurantId}`);
    }

    if (filter.isVegetarian !== undefined) {
      conditions.push(Prisma.sql`mi.is_vegetarian = ${filter.isVegetarian}`);
    }

    if (filter.minPrice !== undefined) {
      conditions.push(
        Prisma.sql`COALESCE(mi.discounted_price, mi.base_price) >= ${filter.minPrice}`,
      );
    }

    if (filter.maxPrice !== undefined) {
      conditions.push(
        Prisma.sql`COALESCE(mi.discounted_price, mi.base_price) <= ${filter.maxPrice}`,
      );
    }

    if (filter.categorySlug) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM restaurant_category_assignments rca
        JOIN restaurant_categories rc ON rc.id = rca.category_id
        WHERE rca.restaurant_id = r.id AND rc.slug = ${filter.categorySlug}
      )`);
    }

    const distance = filter.near
      ? distanceSql(filter.near, Prisma.sql`r.latitude`, Prisma.sql`r.longitude`)
      : Prisma.sql`NULL::double precision`;

    if (filter.near) {
      const requested = filter.radiusMeters ?? 15000;
      conditions.push(Prisma.sql`${distance} <= LEAST(${requested}, r.delivery_radius_meters)`);
    }

    const relevance = hasTerm
      ? Prisma.sql`ts_rank(mi.search_vector, ${tsquery})`
      : Prisma.sql`0::real`;

    const orderBy = this.foodOrder(filter, hasTerm, relevance);
    const offset = (filter.page - 1) * filter.limit;

    const rows = await this.prisma.$queryRaw<FoodRow[]>`
      SELECT
        mi.id, mi.name, mi.description, mi.image_url,
        mi.base_price, mi.discounted_price, mi.is_vegetarian,
        mi.spice_level::text AS spice_level, mi.rating, mi.rating_count,
        r.id AS restaurant_id, r.name AS restaurant_name,
        r.slug AS restaurant_slug, r.rating AS restaurant_rating,
        ${distance} AS distance_meters,
        ${relevance} AS relevance,
        COUNT(*) OVER () AS total_count
      FROM menu_items mi
      JOIN restaurants r ON r.id = mi.restaurant_id
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY ${orderBy}
      LIMIT ${filter.limit} OFFSET ${offset}
    `;

    const total = rows.length > 0 ? Number(rows[0]?.total_count ?? 0) : 0;

    return paginate(rows.map(toFoodHit), total, filter.page, filter.limit);
  }

  async searchCategories(term: string | undefined, limit: number): Promise<CategoryHit[]> {
    const condition =
      term && term.trim().length > 0
        ? Prisma.sql`AND rc.name ILIKE ${'%' + term + '%'}`
        : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        slug: string;
        icon_url: string | null;
        restaurant_count: bigint;
      }>
    >`
      SELECT rc.id, rc.name, rc.slug, rc.icon_url,
        (
          SELECT COUNT(*) FROM restaurant_category_assignments rca
          JOIN restaurants r ON r.id = rca.restaurant_id
          WHERE rca.category_id = rc.id AND r.status = 'ACTIVE' AND r.deleted_at IS NULL
        ) AS restaurant_count
      FROM restaurant_categories rc
      WHERE rc.is_active = true ${condition}
      ORDER BY restaurant_count DESC, rc.sort_order ASC
      LIMIT ${limit}
    `;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      iconUrl: row.icon_url,
      restaurantCount: Number(row.restaurant_count),
    }));
  }

  async trending(windowDays: number, limit: number, cityId?: string): Promise<TrendingHit[]> {
    const cityCondition = cityId ? Prisma.sql`AND r.city_id = ${cityId}` : Prisma.empty;

    // Trending is "what people are actually ordering lately", so it counts
    // delivered orders inside a rolling window rather than lifetime totals —
    // otherwise the same handful of long-established restaurants would sit at
    // the top forever and nothing new could ever surface.
    const rows = await this.prisma.$queryRaw<
      Array<{
        restaurant_id: string;
        name: string;
        slug: string;
        logo_url: string | null;
        rating: string;
        recent_orders: bigint;
      }>
    >`
      SELECT r.id AS restaurant_id, r.name, r.slug, r.logo_url, r.rating,
             COUNT(o.id) AS recent_orders
      FROM restaurants r
      JOIN orders o ON o.restaurant_id = r.id
        AND o.status = 'DELIVERED'
        AND o.created_at >= NOW() - (${windowDays} * INTERVAL '1 day')
      WHERE r.status = 'ACTIVE' AND r.deleted_at IS NULL ${cityCondition}
      GROUP BY r.id, r.name, r.slug, r.logo_url, r.rating
      ORDER BY recent_orders DESC, r.rating DESC
      LIMIT ${limit}
    `;

    return rows.map((row) => ({
      restaurantId: row.restaurant_id,
      name: row.name,
      slug: row.slug,
      logoUrl: row.logo_url,
      rating: Number(row.rating),
      recentOrders: Number(row.recent_orders),
    }));
  }

  async popularFood(limit: number, cityId?: string): Promise<PopularFoodHit[]> {
    const cityCondition = cityId ? Prisma.sql`AND r.city_id = ${cityId}` : Prisma.empty;

    // Popular is the lifetime view: how often a dish has been ordered, broken
    // by its rating. A LEFT JOIN keeps well-rated newcomers with no orders yet
    // from being excluded outright.
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        image_url: string | null;
        effective_price: string;
        rating: string;
        rating_count: number;
        restaurant_name: string;
        restaurant_slug: string;
        order_count: bigint;
      }>
    >`
      SELECT mi.id, mi.name, mi.image_url,
             COALESCE(mi.discounted_price, mi.base_price) AS effective_price,
             mi.rating, mi.rating_count,
             r.name AS restaurant_name, r.slug AS restaurant_slug,
             COUNT(oi.id) AS order_count
      FROM menu_items mi
      JOIN restaurants r ON r.id = mi.restaurant_id
      LEFT JOIN order_items oi ON oi.menu_item_id = mi.id
      WHERE mi.deleted_at IS NULL AND mi.status = 'AVAILABLE'
        AND r.status = 'ACTIVE' AND r.deleted_at IS NULL ${cityCondition}
      GROUP BY mi.id, mi.name, mi.image_url, mi.discounted_price, mi.base_price,
               mi.rating, mi.rating_count, r.name, r.slug
      ORDER BY order_count DESC, mi.rating DESC, mi.rating_count DESC
      LIMIT ${limit}
    `;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      imageUrl: row.image_url,
      effectivePrice: Number(row.effective_price),
      rating: Number(row.rating),
      ratingCount: row.rating_count,
      restaurantName: row.restaurant_name,
      restaurantSlug: row.restaurant_slug,
      orderCount: Number(row.order_count),
    }));
  }

  async autocomplete(term: string, limit: number): Promise<AutocompleteHit[]> {
    const prefix = `${term}%`;
    const contains = `%${term}%`;

    // Suggestions use trigram similarity rather than the full-text vectors:
    // a user typing "kara" has not finished a word yet, and tsquery matches
    // whole lexemes. Trigrams also tolerate the typos that are unavoidable on
    // a phone keyboard. A prefix match is scored 1 so exact starts rank first.
    const rows = await this.prisma.$queryRaw<
      Array<{
        type: string;
        id: string;
        label: string;
        slug: string;
        image_url: string | null;
        score: number;
      }>
    >`
      (
        SELECT 'restaurant' AS type, r.id, r.name AS label, r.slug, r.logo_url AS image_url,
               GREATEST(similarity(r.name, ${term}), CASE WHEN r.name ILIKE ${prefix} THEN 1 ELSE 0 END) AS score
        FROM restaurants r
        WHERE r.status = 'ACTIVE' AND r.deleted_at IS NULL
          AND (r.name ILIKE ${contains} OR similarity(r.name, ${term}) > 0.2)
        ORDER BY score DESC LIMIT ${limit}
      )
      UNION ALL
      (
        SELECT 'dish' AS type, mi.id, mi.name AS label, r.slug, mi.image_url,
               GREATEST(similarity(mi.name, ${term}), CASE WHEN mi.name ILIKE ${prefix} THEN 1 ELSE 0 END) AS score
        FROM menu_items mi
        JOIN restaurants r ON r.id = mi.restaurant_id
        WHERE mi.deleted_at IS NULL AND mi.status = 'AVAILABLE'
          AND r.status = 'ACTIVE' AND r.deleted_at IS NULL
          AND (mi.name ILIKE ${contains} OR similarity(mi.name, ${term}) > 0.2)
        ORDER BY score DESC LIMIT ${limit}
      )
      UNION ALL
      (
        SELECT 'category' AS type, rc.id, rc.name AS label, rc.slug, rc.icon_url AS image_url,
               GREATEST(similarity(rc.name, ${term}), CASE WHEN rc.name ILIKE ${prefix} THEN 1 ELSE 0 END) AS score
        FROM restaurant_categories rc
        WHERE rc.is_active = true
          AND (rc.name ILIKE ${contains} OR similarity(rc.name, ${term}) > 0.2)
        ORDER BY score DESC LIMIT ${limit}
      )
      ORDER BY score DESC, label ASC
      LIMIT ${limit}
    `;

    return rows.map((row) => ({
      type: row.type as AutocompleteHit['type'],
      id: row.id,
      label: row.label,
      slug: row.slug,
      imageUrl: row.image_url,
      score: Number(row.score),
    }));
  }

  private restaurantOrder(
    filter: RestaurantSearchFilter,
    hasTerm: boolean,
    distance: Prisma.Sql,
    relevance: Prisma.Sql,
  ): Prisma.Sql {
    switch (filter.sort) {
      case 'distance':
        return filter.near ? Prisma.sql`${distance} ASC NULLS LAST` : Prisma.sql`r.rating DESC`;
      case 'rating':
        return Prisma.sql`r.rating DESC, r.rating_count DESC`;
      case 'preparation':
        return Prisma.sql`r.avg_preparation_minutes ASC`;
      default:
        // Relevance ordering is meaningless without a search term, so it falls
        // back to the ranking a browsing customer expects.
        return hasTerm
          ? Prisma.sql`${relevance} DESC, r.rating DESC`
          : Prisma.sql`r.is_featured DESC, r.rating DESC, r.rating_count DESC`;
    }
  }

  private foodOrder(filter: FoodSearchFilter, hasTerm: boolean, relevance: Prisma.Sql): Prisma.Sql {
    switch (filter.sort) {
      case 'price_asc':
        return Prisma.sql`COALESCE(mi.discounted_price, mi.base_price) ASC`;
      case 'price_desc':
        return Prisma.sql`COALESCE(mi.discounted_price, mi.base_price) DESC`;
      case 'rating':
        return Prisma.sql`mi.rating DESC, mi.rating_count DESC`;
      default:
        return hasTerm
          ? Prisma.sql`${relevance} DESC, mi.rating DESC`
          : Prisma.sql`mi.is_featured DESC, mi.rating DESC`;
    }
  }
}

function toRestaurantHit(row: RestaurantRow): RestaurantSearchHit {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logoUrl: row.logo_url,
    coverUrl: row.cover_url,
    description: row.description,
    rating: Number(row.rating),
    ratingCount: row.rating_count,
    priceRange: row.price_range as RestaurantSearchHit['priceRange'],
    minOrderAmount: Number(row.min_order_amount),
    avgPreparationMinutes: row.avg_preparation_minutes,
    cityName: row.city_name,
    zoneName: row.zone_name,
    categories: row.categories ?? [],
    isAcceptingOrders: row.is_accepting_orders,
    distanceMeters: row.distance_meters === null ? null : Math.round(Number(row.distance_meters)),
    relevance: Number(row.relevance),
  };
}

function toFoodHit(row: FoodRow): FoodSearchHit {
  const base = Number(row.base_price);
  const discounted = row.discounted_price === null ? null : Number(row.discounted_price);

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    imageUrl: row.image_url,
    basePrice: base,
    discountedPrice: discounted,
    effectivePrice: discounted ?? base,
    isVegetarian: row.is_vegetarian,
    spiceLevel: row.spice_level,
    rating: Number(row.rating),
    ratingCount: row.rating_count,
    restaurantId: row.restaurant_id,
    restaurantName: row.restaurant_name,
    restaurantSlug: row.restaurant_slug,
    restaurantRating: Number(row.restaurant_rating),
    distanceMeters: row.distance_meters === null ? null : Math.round(Number(row.distance_meters)),
    relevance: Number(row.relevance),
  };
}
