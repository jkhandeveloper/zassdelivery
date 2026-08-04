import {
  ActorType,
  AddressLabel,
  BannerPlacement,
  CouponType,
  DayOfWeek,
  DriverAvailability,
  DriverStatus,
  MenuItemStatus,
  NotificationChannel,
  NotificationType,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PaymentStatus,
  PriceRange,
  PrismaClient,
  RestaurantStatus,
  SettingValueType,
  SpiceLevel,
  TransactionStatus,
  TransactionType,
  UserRole,
  UserStatus,
  VehicleType,
  WalletTransactionReason,
  WalletTransactionType,
} from '@prisma/client';
import * as argon2 from 'argon2';

/**
 * Seeds reference data and a small but complete slice of operational data.
 *
 * Every write is an upsert keyed on a natural unique column, so the script is
 * idempotent: running it repeatedly converges on the same state instead of
 * duplicating rows or failing.
 */
const prisma = new PrismaClient();

// ═════════════════════════════════════════════════════════════
// RBAC
// ═════════════════════════════════════════════════════════════

/** Capability catalogue, addressed as `resource.action`. */
const PERMISSION_MATRIX: Record<string, string[]> = {
  users: ['read', 'create', 'update', 'delete', 'suspend'],
  restaurants: ['read', 'create', 'update', 'delete', 'approve', 'suspend'],
  menus: ['read', 'create', 'update', 'delete'],
  orders: ['read', 'create', 'update', 'cancel', 'refund', 'assign'],
  drivers: ['read', 'create', 'update', 'approve', 'suspend'],
  payments: ['read', 'refund'],
  coupons: ['read', 'create', 'update', 'delete'],
  reviews: ['read', 'moderate'],
  tickets: ['read', 'create', 'update', 'assign', 'close'],
  settings: ['read', 'update'],
  banners: ['read', 'create', 'update', 'delete'],
  faqs: ['read', 'create', 'update', 'delete'],
  audit: ['read'],
  analytics: ['read'],
};

const ALL_PERMISSIONS = Object.entries(PERMISSION_MATRIX).flatMap(([resource, actions]) =>
  actions.map((action) => `${resource}.${action}`),
);

/**
 * Which capabilities each role holds. `*` means every permission.
 *
 * ADMIN is deliberately not given `users.delete` or `settings.update`:
 * destroying accounts and changing platform-wide configuration stay with
 * SUPER_ADMIN.
 */
const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  [UserRole.SUPER_ADMIN]: ['*'],
  [UserRole.ADMIN]: ALL_PERMISSIONS.filter(
    (code) => code !== 'users.delete' && code !== 'settings.update',
  ),
  [UserRole.VENDOR_OWNER]: [
    'restaurants.read',
    'restaurants.update',
    'menus.read',
    'menus.create',
    'menus.update',
    'menus.delete',
    'orders.read',
    'orders.update',
    'reviews.read',
    'analytics.read',
  ],
  [UserRole.VENDOR_STAFF]: ['menus.read', 'menus.update', 'orders.read', 'orders.update'],
  [UserRole.RIDER]: ['orders.read', 'orders.update'],
  [UserRole.CUSTOMER]: [
    'orders.read',
    'orders.create',
    'orders.cancel',
    'reviews.read',
    'tickets.create',
    'tickets.read',
  ],
};

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  [UserRole.SUPER_ADMIN]: 'Unrestricted access to every part of the platform.',
  [UserRole.ADMIN]: 'Day-to-day platform operations and moderation.',
  [UserRole.VENDOR_OWNER]: 'Owns one or more restaurants and their menus.',
  [UserRole.VENDOR_STAFF]: 'Works in a restaurant; manages menus and incoming orders.',
  [UserRole.RIDER]: 'Delivers orders to customers.',
  [UserRole.CUSTOMER]: 'Places orders on the platform.',
};

async function seedRbac(): Promise<void> {
  for (const code of ALL_PERMISSIONS) {
    const [resource, action] = code.split('.') as [string, string];
    await prisma.permission.upsert({
      where: { code },
      update: { resource, action },
      create: { code, resource, action, description: `Allows ${action} on ${resource}.` },
    });
  }
  console.warn(`  ✓ ${ALL_PERMISSIONS.length} permissions`);

  for (const role of Object.values(UserRole)) {
    const slug = role.toLowerCase();
    const record = await prisma.role.upsert({
      where: { slug },
      update: { description: ROLE_DESCRIPTIONS[role] },
      create: {
        name: role
          .split('_')
          .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
          .join(' '),
        slug,
        description: ROLE_DESCRIPTIONS[role],
        isSystem: true,
      },
    });

    const granted = ROLE_PERMISSIONS[role];
    const codes = granted[0] === '*' ? ALL_PERMISSIONS : granted;
    const permissions = await prisma.permission.findMany({ where: { code: { in: codes } } });

    for (const permission of permissions) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: record.id, permissionId: permission.id } },
        update: {},
        create: { roleId: record.id, permissionId: permission.id },
      });
    }

    console.warn(`  ✓ role ${slug} (${permissions.length} permissions)`);
  }
}

// ═════════════════════════════════════════════════════════════
// GEOGRAPHY
// ═════════════════════════════════════════════════════════════

interface ZoneSeed {
  name: string;
  slug: string;
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  deliveryFee: number;
  minOrderAmount: number;
  etaMinutes: number;
}

interface CitySeed {
  name: string;
  nameUr: string;
  slug: string;
  zones: ZoneSeed[];
}

/**
 * Coordinates are the real town/neighbourhood centres.
 *
 * Pabbi is administratively part of Nowshera District, but it is listed as its
 * own city because that is how customers pick their location — matching the
 * user's mental model matters more here than the district hierarchy.
 */
const CITIES: CitySeed[] = [
  {
    name: 'Peshawar',
    nameUr: 'پشاور',
    slug: 'peshawar',
    zones: [
      {
        name: 'Hayatabad',
        slug: 'hayatabad',
        centerLat: 33.995,
        centerLng: 71.44,
        radiusMeters: 4500,
        deliveryFee: 79,
        minOrderAmount: 300,
        etaMinutes: 35,
      },
      {
        name: 'University Town',
        slug: 'university-town',
        centerLat: 34.0009,
        centerLng: 71.489,
        radiusMeters: 3000,
        deliveryFee: 69,
        minOrderAmount: 250,
        etaMinutes: 30,
      },
      {
        name: 'Saddar',
        slug: 'saddar',
        centerLat: 34.008,
        centerLng: 71.561,
        radiusMeters: 3500,
        deliveryFee: 79,
        minOrderAmount: 250,
        etaMinutes: 35,
      },
      {
        name: 'Peshawar City',
        slug: 'peshawar-city',
        centerLat: 34.01,
        centerLng: 71.57,
        radiusMeters: 4000,
        deliveryFee: 89,
        minOrderAmount: 300,
        etaMinutes: 40,
      },
    ],
  },
  {
    name: 'Nowshera',
    nameUr: 'نوشہرہ',
    slug: 'nowshera',
    zones: [
      {
        name: 'Nowshera Cantt',
        slug: 'nowshera-cantt',
        centerLat: 34.015,
        centerLng: 71.975,
        radiusMeters: 4000,
        deliveryFee: 89,
        minOrderAmount: 300,
        etaMinutes: 40,
      },
      {
        name: 'Nowshera Kalan',
        slug: 'nowshera-kalan',
        centerLat: 34.025,
        centerLng: 71.96,
        radiusMeters: 3500,
        deliveryFee: 89,
        minOrderAmount: 300,
        etaMinutes: 40,
      },
      {
        name: 'Risalpur',
        slug: 'risalpur',
        centerLat: 34.06,
        centerLng: 71.99,
        radiusMeters: 5000,
        deliveryFee: 109,
        minOrderAmount: 350,
        etaMinutes: 50,
      },
    ],
  },
  {
    name: 'Pabbi',
    nameUr: 'پبی',
    slug: 'pabbi',
    zones: [
      {
        name: 'Pabbi Central',
        slug: 'pabbi-central',
        centerLat: 34.0086,
        centerLng: 71.7876,
        radiusMeters: 3500,
        deliveryFee: 69,
        minOrderAmount: 250,
        etaMinutes: 30,
      },
      {
        name: 'Pabbi Bypass',
        slug: 'pabbi-bypass',
        centerLat: 34.015,
        centerLng: 71.8,
        radiusMeters: 3000,
        deliveryFee: 79,
        minOrderAmount: 250,
        etaMinutes: 35,
      },
    ],
  },
];

/** Distance bands applied to every zone. */
const FEE_BANDS = [
  { name: 'Up to 3 km', minDistanceKm: 0, maxDistanceKm: 3, baseFee: 59, perKmFee: 0 },
  { name: '3 to 6 km', minDistanceKm: 3, maxDistanceKm: 6, baseFee: 89, perKmFee: 10 },
  { name: '6 to 12 km', minDistanceKm: 6, maxDistanceKm: 12, baseFee: 129, perKmFee: 15 },
];

async function seedGeography(): Promise<void> {
  for (const city of CITIES) {
    const record = await prisma.city.upsert({
      where: { slug: city.slug },
      update: { name: city.name, nameUr: city.nameUr, isActive: true },
      create: { name: city.name, nameUr: city.nameUr, slug: city.slug },
    });

    for (const zone of city.zones) {
      const zoneRecord = await prisma.zone.upsert({
        where: { cityId_slug: { cityId: record.id, slug: zone.slug } },
        update: { ...zone, isActive: true },
        create: { cityId: record.id, ...zone },
      });

      for (const band of FEE_BANDS) {
        await prisma.deliveryFee.upsert({
          where: {
            zoneId_minDistanceKm: { zoneId: zoneRecord.id, minDistanceKm: band.minDistanceKm },
          },
          update: { ...band, freeDeliveryThreshold: 2000 },
          create: { zoneId: zoneRecord.id, ...band, freeDeliveryThreshold: 2000 },
        });
      }
    }

    console.warn(
      `  ✓ ${city.name} — ${city.zones.length} zones, ${city.zones.length * FEE_BANDS.length} fee bands`,
    );
  }
}

// ═════════════════════════════════════════════════════════════
// USERS
// ═════════════════════════════════════════════════════════════

interface UserSeed {
  phone: string;
  fullName: string;
  email?: string;
  role: UserRole;
}

/**
 * Operational accounts. Passwords are intentionally absent: phone + OTP is the
 * login path, and the Auth module owns credential issuance.
 */
const USERS: UserSeed[] = [
  {
    phone: '+923000000001',
    fullName: 'Platform Super Admin',
    email: 'superadmin@zassdelivery.pk',
    role: UserRole.SUPER_ADMIN,
  },
  {
    phone: '+923000000002',
    fullName: 'Operations Admin',
    email: 'ops@zassdelivery.pk',
    role: UserRole.ADMIN,
  },
  { phone: '+923001234567', fullName: 'Ahmad Khan', role: UserRole.CUSTOMER },
  { phone: '+923007654321', fullName: 'Sana Bibi', role: UserRole.CUSTOMER },
  { phone: '+923009876543', fullName: 'Bilal Shah', role: UserRole.RIDER },
  { phone: '+923009876544', fullName: 'Imran Gul', role: UserRole.RIDER },
  {
    phone: '+923005551234',
    fullName: 'Chapli Kabab House Owner',
    email: 'owner@chaplikabab.pk',
    role: UserRole.VENDOR_OWNER,
  },
  {
    phone: '+923005551235',
    fullName: 'Peshawar BBQ Owner',
    email: 'owner@peshawarbbq.pk',
    role: UserRole.VENDOR_OWNER,
  },
  { phone: '+923005551236', fullName: 'Kitchen Staff', role: UserRole.VENDOR_STAFF },
];

/**
 * Shared development password for every seeded account, so the auth endpoints
 * can be exercised on a fresh database. Hashed once and reused: Argon2 is
 * deliberately slow, and hashing it per user would dominate the seed's runtime.
 */
const SEED_PASSWORD = 'Zass@1234';

async function seedUsers(): Promise<void> {
  const verifiedAt = new Date();
  const passwordHash = await argon2.hash(SEED_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  for (const user of USERS) {
    const record = await prisma.user.upsert({
      where: { phone: user.phone },
      update: {
        fullName: user.fullName,
        role: user.role,
        status: UserStatus.ACTIVE,
        passwordHash,
      },
      create: {
        phone: user.phone,
        fullName: user.fullName,
        email: user.email ?? null,
        role: user.role,
        status: UserStatus.ACTIVE,
        phoneVerifiedAt: verifiedAt,
        passwordHash,
      },
    });

    // Mirror the primary role into the assignment table so permission lookups
    // have a row to join even before an admin grants anything extra.
    const role = await prisma.role.findUnique({ where: { slug: user.role.toLowerCase() } });
    if (role) {
      await prisma.userRoleAssignment.upsert({
        where: { userId_roleId: { userId: record.id, roleId: role.id } },
        update: {},
        create: { userId: record.id, roleId: role.id },
      });
    }

    // Every account gets a wallet up front, so refunds never have to create one
    // mid-transaction.
    await prisma.wallet.upsert({
      where: { userId: record.id },
      update: {},
      create: { userId: record.id },
    });
  }

  console.warn(
    `  ✓ ${USERS.length} users (password "${SEED_PASSWORD}"), each with a role assignment and wallet`,
  );
}

async function seedAddresses(): Promise<void> {
  const customer = await prisma.user.findUniqueOrThrow({ where: { phone: '+923001234567' } });
  const zone = await prisma.zone.findFirstOrThrow({ where: { slug: 'pabbi-central' } });

  const existing = await prisma.address.findFirst({
    where: { userId: customer.id, deletedAt: null },
  });

  if (existing) {
    console.warn('  ✓ sample address already present');
    return;
  }

  await prisma.address.create({
    data: {
      userId: customer.id,
      label: AddressLabel.HOME,
      line1: 'House 14, Street 3, Gulshan Colony',
      landmark: 'Near Pabbi Bus Stand',
      cityId: zone.cityId,
      zoneId: zone.id,
      latitude: 34.0091,
      longitude: 71.7869,
      deliveryNotes: 'Green gate, ring the bell twice.',
      isDefault: true,
    },
  });

  console.warn('  ✓ sample default address created');
}

// ═════════════════════════════════════════════════════════════
// DRIVERS
// ═════════════════════════════════════════════════════════════

async function seedDrivers(): Promise<void> {
  const drivers = [
    {
      phone: '+923009876543',
      cnic: '1710112345671',
      plate: 'PES-4821',
      zone: 'pabbi-central',
      type: VehicleType.MOTORCYCLE,
    },
    {
      phone: '+923009876544',
      cnic: '1710112345672',
      plate: 'NOW-1193',
      zone: 'nowshera-cantt',
      type: VehicleType.MOTORCYCLE,
    },
  ];

  for (const entry of drivers) {
    const user = await prisma.user.findUniqueOrThrow({ where: { phone: entry.phone } });
    const zone = await prisma.zone.findFirstOrThrow({ where: { slug: entry.zone } });

    const driver = await prisma.driver.upsert({
      where: { userId: user.id },
      update: { status: DriverStatus.ACTIVE, availability: DriverAvailability.ONLINE },
      create: {
        userId: user.id,
        cnic: entry.cnic,
        zoneId: zone.id,
        status: DriverStatus.ACTIVE,
        availability: DriverAvailability.ONLINE,
        currentLat: zone.centerLat,
        currentLng: zone.centerLng,
        lastLocationAt: new Date(),
        verifiedAt: new Date(),
      },
    });

    const vehicle = await prisma.vehicle.findUnique({ where: { plateNumber: entry.plate } });
    if (!vehicle) {
      await prisma.vehicle.create({
        data: {
          driverId: driver.id,
          type: entry.type,
          make: 'Honda',
          model: 'CD 70',
          year: 2022,
          color: 'Red',
          plateNumber: entry.plate,
        },
      });
    }
  }

  console.warn(`  ✓ ${drivers.length} drivers with vehicles`);
}

// ═════════════════════════════════════════════════════════════
// RESTAURANTS & MENUS
// ═════════════════════════════════════════════════════════════

const RESTAURANT_CATEGORIES = [
  { name: 'Desi', nameUr: 'دیسی', slug: 'desi', sortOrder: 1 },
  { name: 'BBQ', nameUr: 'باربی کیو', slug: 'bbq', sortOrder: 2 },
  { name: 'Fast Food', nameUr: 'فاسٹ فوڈ', slug: 'fast-food', sortOrder: 3 },
  { name: 'Pizza', nameUr: 'پیزا', slug: 'pizza', sortOrder: 4 },
  { name: 'Karahi', nameUr: 'کڑاہی', slug: 'karahi', sortOrder: 5 },
  { name: 'Beverages', nameUr: 'مشروبات', slug: 'beverages', sortOrder: 6 },
];

interface ItemSeed {
  name: string;
  description: string;
  basePrice: number;
  spiceLevel?: SpiceLevel;
  isVegetarian?: boolean;
  variants?: { name: string; price: number; isDefault?: boolean }[];
  addOnGroups?: {
    name: string;
    minSelect: number;
    maxSelect: number;
    isRequired: boolean;
    addOns: { name: string; price: number }[];
  }[];
}

interface RestaurantSeed {
  ownerPhone: string;
  name: string;
  slug: string;
  description: string;
  phone: string;
  zoneSlug: string;
  addressLine: string;
  latitude: number;
  longitude: number;
  categories: string[];
  priceRange: PriceRange;
  menuCategories: { name: string; nameUr: string; items: ItemSeed[] }[];
}

const RESTAURANTS: RestaurantSeed[] = [
  {
    ownerPhone: '+923005551234',
    name: 'Chapli Kabab House',
    slug: 'chapli-kabab-house-pabbi',
    description: 'Traditional Peshawari chapli kababs, grilled fresh on order.',
    phone: '+923005551234',
    zoneSlug: 'pabbi-central',
    addressLine: 'Main GT Road, near Pabbi Bus Stand',
    latitude: 34.0088,
    longitude: 71.7881,
    categories: ['desi', 'bbq'],
    priceRange: PriceRange.BUDGET,
    menuCategories: [
      {
        name: 'Kababs',
        nameUr: 'کباب',
        items: [
          {
            name: 'Chapli Kabab',
            description: 'Minced beef kabab with tomato, coriander and pomegranate seeds.',
            basePrice: 250,
            spiceLevel: SpiceLevel.MEDIUM,
            variants: [
              { name: 'Single', price: 250, isDefault: true },
              { name: 'Plate of 3', price: 700 },
            ],
            addOnGroups: [
              {
                name: 'Add bread',
                minSelect: 0,
                maxSelect: 2,
                isRequired: false,
                addOns: [
                  { name: 'Naan', price: 30 },
                  { name: 'Roghani Naan', price: 60 },
                ],
              },
            ],
          },
          {
            name: 'Seekh Kabab',
            description: 'Charcoal-grilled minced beef skewers.',
            basePrice: 180,
            spiceLevel: SpiceLevel.HOT,
          },
        ],
      },
      {
        name: 'Karahi',
        nameUr: 'کڑاہی',
        items: [
          {
            name: 'Chicken Karahi',
            description: 'Wok-cooked chicken in tomato and green chilli.',
            basePrice: 1100,
            spiceLevel: SpiceLevel.HOT,
            variants: [
              { name: 'Half', price: 1100, isDefault: true },
              { name: 'Full', price: 2000 },
            ],
          },
        ],
      },
      {
        name: 'Drinks',
        nameUr: 'مشروبات',
        items: [
          {
            name: 'Fresh Lassi',
            description: 'Sweet yoghurt drink.',
            basePrice: 150,
            isVegetarian: true,
          },
          {
            name: 'Soft Drink 500ml',
            description: 'Chilled bottle.',
            basePrice: 100,
            isVegetarian: true,
          },
        ],
      },
    ],
  },
  {
    ownerPhone: '+923005551235',
    name: 'Peshawar BBQ & Grill',
    slug: 'peshawar-bbq-and-grill',
    description: 'Charcoal grill specialists serving Hayatabad since 2009.',
    phone: '+923005551235',
    zoneSlug: 'hayatabad',
    addressLine: 'Phase 3, Hayatabad',
    latitude: 33.9962,
    longitude: 71.4412,
    categories: ['bbq', 'desi', 'karahi'],
    priceRange: PriceRange.MODERATE,
    menuCategories: [
      {
        name: 'Grill',
        nameUr: 'گرل',
        items: [
          {
            name: 'Mutton Tikka',
            description: 'Marinated mutton, charcoal grilled.',
            basePrice: 650,
            spiceLevel: SpiceLevel.MEDIUM,
          },
          {
            name: 'Chicken Malai Boti',
            description: 'Creamy marinated chicken cubes.',
            basePrice: 550,
            spiceLevel: SpiceLevel.MILD,
          },
        ],
      },
      {
        name: 'Rice',
        nameUr: 'چاول',
        items: [
          {
            name: 'Kabuli Pulao',
            description: 'Afghani-style rice with lamb, raisins and carrot.',
            basePrice: 900,
            spiceLevel: SpiceLevel.MILD,
            variants: [
              { name: 'Half', price: 900, isDefault: true },
              { name: 'Full', price: 1700 },
            ],
          },
        ],
      },
    ],
  },
  {
    ownerPhone: '+923005551235',
    name: 'Nowshera Pizza Point',
    slug: 'nowshera-pizza-point',
    description: 'Hand-tossed pizzas, burgers and fries.',
    phone: '+923005551236',
    zoneSlug: 'nowshera-cantt',
    addressLine: 'Cantt Bazaar, Nowshera',
    latitude: 34.0158,
    longitude: 71.9762,
    categories: ['fast-food', 'pizza'],
    priceRange: PriceRange.MODERATE,
    menuCategories: [
      {
        name: 'Pizzas',
        nameUr: 'پیزا',
        items: [
          {
            name: 'Chicken Tikka Pizza',
            description: 'Tikka chicken, onion, capsicum and mozzarella.',
            basePrice: 850,
            spiceLevel: SpiceLevel.MEDIUM,
            variants: [
              { name: 'Small', price: 850, isDefault: true },
              { name: 'Medium', price: 1300 },
              { name: 'Large', price: 1800 },
            ],
            addOnGroups: [
              {
                name: 'Extra toppings',
                minSelect: 0,
                maxSelect: 3,
                isRequired: false,
                addOns: [
                  { name: 'Extra Cheese', price: 150 },
                  { name: 'Jalapenos', price: 80 },
                  { name: 'Olives', price: 80 },
                ],
              },
            ],
          },
        ],
      },
      {
        name: 'Burgers',
        nameUr: 'برگر',
        items: [
          {
            name: 'Zinger Burger',
            description: 'Crispy chicken fillet with mayo and lettuce.',
            basePrice: 450,
          },
        ],
      },
    ],
  },
];

async function seedRestaurants(): Promise<void> {
  for (const category of RESTAURANT_CATEGORIES) {
    await prisma.restaurantCategory.upsert({
      where: { slug: category.slug },
      update: category,
      create: category,
    });
  }
  console.warn(`  ✓ ${RESTAURANT_CATEGORIES.length} restaurant categories`);

  for (const seed of RESTAURANTS) {
    const owner = await prisma.user.findUniqueOrThrow({ where: { phone: seed.ownerPhone } });
    const zone = await prisma.zone.findFirstOrThrow({ where: { slug: seed.zoneSlug } });

    const restaurant = await prisma.restaurant.upsert({
      where: { slug: seed.slug },
      update: { name: seed.name, status: RestaurantStatus.ACTIVE, isAcceptingOrders: true },
      create: {
        ownerId: owner.id,
        name: seed.name,
        slug: seed.slug,
        description: seed.description,
        phone: seed.phone,
        cityId: zone.cityId,
        zoneId: zone.id,
        addressLine: seed.addressLine,
        latitude: seed.latitude,
        longitude: seed.longitude,
        status: RestaurantStatus.ACTIVE,
        priceRange: seed.priceRange,
        minOrderAmount: 250,
        avgPreparationMinutes: 25,
        commissionRate: 15,
      },
    });

    for (const slug of seed.categories) {
      const category = await prisma.restaurantCategory.findUniqueOrThrow({ where: { slug } });
      await prisma.restaurantCategoryAssignment.upsert({
        where: {
          restaurantId_categoryId: { restaurantId: restaurant.id, categoryId: category.id },
        },
        update: {},
        create: { restaurantId: restaurant.id, categoryId: category.id },
      });
    }

    // Open every day 11:00–23:00; Friday opens later for Jumu'ah prayers.
    for (const day of Object.values(DayOfWeek)) {
      await prisma.restaurantHour.upsert({
        where: { restaurantId_dayOfWeek: { restaurantId: restaurant.id, dayOfWeek: day } },
        update: {},
        create: {
          restaurantId: restaurant.id,
          dayOfWeek: day,
          opensAt: day === DayOfWeek.FRIDAY ? '14:00' : '11:00',
          closesAt: '23:00',
        },
      });
    }

    if ((await prisma.restaurantImage.count({ where: { restaurantId: restaurant.id } })) === 0) {
      await prisma.restaurantImage.createMany({
        data: [
          {
            restaurantId: restaurant.id,
            url: `https://cdn.zassdelivery.pk/${seed.slug}/cover.jpg`,
            caption: 'Storefront',
            sortOrder: 0,
          },
          {
            restaurantId: restaurant.id,
            url: `https://cdn.zassdelivery.pk/${seed.slug}/interior.jpg`,
            caption: 'Dining area',
            sortOrder: 1,
          },
        ],
      });
    }

    const menu = await prisma.menu.upsert({
      where: { restaurantId_name: { restaurantId: restaurant.id, name: 'Main Menu' } },
      update: {},
      create: { restaurantId: restaurant.id, name: 'Main Menu', isActive: true },
    });

    let categoryOrder = 0;
    for (const menuCategory of seed.menuCategories) {
      const category = await prisma.menuCategory.upsert({
        where: { menuId_name: { menuId: menu.id, name: menuCategory.name } },
        update: { sortOrder: categoryOrder },
        create: {
          menuId: menu.id,
          name: menuCategory.name,
          nameUr: menuCategory.nameUr,
          sortOrder: categoryOrder,
        },
      });
      categoryOrder += 1;

      let itemOrder = 0;
      for (const item of menuCategory.items) {
        const existing = await prisma.menuItem.findFirst({
          where: { menuCategoryId: category.id, name: item.name },
        });

        const menuItem =
          existing ??
          (await prisma.menuItem.create({
            data: {
              menuCategoryId: category.id,
              restaurantId: restaurant.id,
              name: item.name,
              description: item.description,
              basePrice: item.basePrice,
              spiceLevel: item.spiceLevel ?? SpiceLevel.NONE,
              isVegetarian: item.isVegetarian ?? false,
              status: MenuItemStatus.AVAILABLE,
              sortOrder: itemOrder,
            },
          }));
        itemOrder += 1;

        for (const [index, variant] of (item.variants ?? []).entries()) {
          await prisma.menuVariant.upsert({
            where: { menuItemId_name: { menuItemId: menuItem.id, name: variant.name } },
            update: { price: variant.price },
            create: {
              menuItemId: menuItem.id,
              name: variant.name,
              price: variant.price,
              isDefault: variant.isDefault ?? false,
              sortOrder: index,
            },
          });
        }

        for (const [index, group] of (item.addOnGroups ?? []).entries()) {
          const groupRecord = await prisma.addOnGroup.upsert({
            where: { menuItemId_name: { menuItemId: menuItem.id, name: group.name } },
            update: {},
            create: {
              menuItemId: menuItem.id,
              name: group.name,
              minSelect: group.minSelect,
              maxSelect: group.maxSelect,
              isRequired: group.isRequired,
              sortOrder: index,
            },
          });

          for (const [addOnIndex, addOn] of group.addOns.entries()) {
            await prisma.addOn.upsert({
              where: { groupId_name: { groupId: groupRecord.id, name: addOn.name } },
              update: { price: addOn.price },
              create: {
                groupId: groupRecord.id,
                name: addOn.name,
                price: addOn.price,
                sortOrder: addOnIndex,
              },
            });
          }
        }
      }
    }

    console.warn(`  ✓ ${seed.name} — ${seed.menuCategories.length} menu categories`);
  }
}

// ═════════════════════════════════════════════════════════════
// PROMOTIONS & CONTENT
// ═════════════════════════════════════════════════════════════

async function seedCoupons(): Promise<void> {
  const admin = await prisma.user.findUniqueOrThrow({ where: { phone: '+923000000002' } });
  const now = new Date();
  const inNinetyDays = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  const coupons = [
    {
      code: 'ZASS100',
      type: CouponType.FIXED_AMOUNT,
      value: 100,
      minOrderAmount: 500,
      description: 'Rs. 100 off your order.',
      perUserLimit: 3,
      usageLimit: 1000,
    },
    {
      code: 'WELCOME20',
      type: CouponType.PERCENTAGE,
      value: 20,
      maxDiscountAmount: 300,
      minOrderAmount: 400,
      description: '20% off your first order.',
      firstOrderOnly: true,
      perUserLimit: 1,
      usageLimit: null,
    },
    {
      code: 'FREEDEL',
      type: CouponType.FREE_DELIVERY,
      value: 0,
      minOrderAmount: 700,
      description: 'Free delivery on orders above Rs. 700.',
      perUserLimit: 5,
      usageLimit: 500,
    },
  ];

  for (const coupon of coupons) {
    await prisma.coupon.upsert({
      where: { code: coupon.code },
      update: { isActive: true, expiresAt: inNinetyDays },
      create: {
        ...coupon,
        maxDiscountAmount: coupon.maxDiscountAmount ?? null,
        firstOrderOnly: coupon.firstOrderOnly ?? false,
        startsAt: now,
        expiresAt: inNinetyDays,
        createdById: admin.id,
      },
    });
  }

  console.warn(`  ✓ ${coupons.length} coupons`);
}

async function seedContent(): Promise<void> {
  const banners = [
    {
      title: 'Free delivery over Rs. 700',
      subtitle: 'Use code FREEDEL at checkout',
      placement: BannerPlacement.HOME_TOP,
      sortOrder: 0,
    },
    {
      title: 'Peshawari BBQ Week',
      subtitle: 'Up to 20% off selected grills',
      placement: BannerPlacement.HOME_MIDDLE,
      sortOrder: 1,
    },
  ];

  for (const banner of banners) {
    const existing = await prisma.banner.findFirst({ where: { title: banner.title } });
    if (!existing) {
      await prisma.banner.create({
        data: {
          ...banner,
          imageUrl: `https://cdn.zassdelivery.pk/banners/${banner.placement.toLowerCase()}.jpg`,
        },
      });
    }
  }
  console.warn(`  ✓ ${banners.length} banners`);

  /**
   * Platform configuration an administrator can change without a deployment.
   * `isPublic` entries are safe to expose to the mobile apps.
   */
  const settings = [
    {
      key: 'platform.service_fee_percentage',
      value: '5',
      valueType: SettingValueType.NUMBER,
      group: 'pricing',
      isPublic: true,
      description: 'Service fee applied to the order subtotal.',
    },
    {
      key: 'platform.tax_percentage',
      value: '0',
      valueType: SettingValueType.NUMBER,
      group: 'pricing',
      isPublic: true,
      description: 'Sales tax percentage. Zero until registration completes.',
    },
    {
      key: 'platform.min_order_amount',
      value: '250',
      valueType: SettingValueType.NUMBER,
      group: 'pricing',
      isPublic: true,
      description: 'Global floor for order subtotal, in PKR.',
    },
    {
      key: 'orders.cancellation_window_minutes',
      value: '5',
      valueType: SettingValueType.NUMBER,
      group: 'orders',
      isPublic: true,
      description: 'Minutes during which a customer may cancel free of charge.',
    },
    {
      key: 'orders.auto_reject_minutes',
      value: '10',
      valueType: SettingValueType.NUMBER,
      group: 'orders',
      isPublic: false,
      description: 'Unconfirmed orders are auto-rejected after this long.',
    },
    {
      key: 'otp.length',
      value: '6',
      valueType: SettingValueType.NUMBER,
      group: 'auth',
      isPublic: false,
      description: 'Number of digits in a login OTP.',
    },
    {
      key: 'otp.ttl_seconds',
      value: '300',
      valueType: SettingValueType.NUMBER,
      group: 'auth',
      isPublic: false,
      description: 'How long an OTP stays valid.',
    },
    {
      key: 'otp.max_attempts',
      value: '5',
      valueType: SettingValueType.NUMBER,
      group: 'auth',
      isPublic: false,
      description: 'Failed OTP attempts before lockout.',
    },
    {
      key: 'support.phone',
      value: '+923000000000',
      valueType: SettingValueType.STRING,
      group: 'support',
      isPublic: true,
      description: 'Customer support hotline.',
    },
    {
      key: 'app.maintenance_mode',
      value: 'false',
      valueType: SettingValueType.BOOLEAN,
      group: 'general',
      isPublic: true,
      description: 'Blocks ordering while true.',
    },
  ];

  for (const setting of settings) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      update: { value: setting.value, description: setting.description },
      create: setting,
    });
  }
  console.warn(`  ✓ ${settings.length} settings`);

  const faqs = [
    {
      question: 'Which areas do you deliver to?',
      answer:
        'We currently deliver across Pabbi, Nowshera and Peshawar. Enter your address at checkout to confirm coverage.',
      questionUr: 'آپ کن علاقوں میں ڈیلیوری کرتے ہیں؟',
      category: 'delivery',
      sortOrder: 0,
    },
    {
      question: 'How do I pay for my order?',
      answer:
        'Cash on delivery is available everywhere. You can also pay from your ZassDelivery wallet.',
      questionUr: 'میں اپنے آرڈر کی ادائیگی کیسے کروں؟',
      category: 'payments',
      sortOrder: 1,
    },
    {
      question: 'Can I cancel my order?',
      answer:
        'Yes, free of charge within 5 minutes of placing it, as long as the restaurant has not started preparing your food.',
      category: 'orders',
      sortOrder: 2,
    },
    {
      question: 'How long does delivery take?',
      answer:
        'Most orders arrive within 30 to 45 minutes, depending on your zone and how busy the restaurant is.',
      category: 'delivery',
      sortOrder: 3,
    },
    {
      question: 'How do I become a delivery rider?',
      answer:
        'Register in the app as a rider, upload your CNIC and licence, and our team will review your application.',
      category: 'riders',
      sortOrder: 4,
    },
  ];

  for (const faq of faqs) {
    const existing = await prisma.faq.findFirst({ where: { question: faq.question } });
    if (!existing) {
      await prisma.faq.create({ data: faq });
    }
  }
  console.warn(`  ✓ ${faqs.length} FAQs`);
}

// ═════════════════════════════════════════════════════════════
// SAMPLE ORDER
// ═════════════════════════════════════════════════════════════

/**
 * One completed order with its full paper trail: items, status history,
 * payment, ledger entries, wallet movement, review and notification.
 *
 * This exists so the order, payment and review endpoints have realistic data
 * to read on a fresh database, rather than every developer having to click
 * through a checkout first.
 */
async function seedSampleOrder(): Promise<void> {
  const orderNumber = 'ZD-260804-0001';

  if (await prisma.order.findUnique({ where: { orderNumber } })) {
    console.warn('  ✓ sample order already present');
    return;
  }

  const customer = await prisma.user.findUniqueOrThrow({ where: { phone: '+923001234567' } });
  const restaurant = await prisma.restaurant.findUniqueOrThrow({
    where: { slug: 'chapli-kabab-house-pabbi' },
  });
  const driver = await prisma.driver.findFirstOrThrow({
    where: { user: { phone: '+923009876543' } },
  });
  const address = await prisma.address.findFirstOrThrow({ where: { userId: customer.id } });
  const kabab = await prisma.menuItem.findFirstOrThrow({
    where: { restaurantId: restaurant.id, name: 'Chapli Kabab' },
  });
  const platter = await prisma.menuVariant.findFirstOrThrow({
    where: { menuItemId: kabab.id, name: 'Plate of 3' },
  });
  const naan = await prisma.addOn.findFirstOrThrow({ where: { name: 'Naan' } });
  const lassi = await prisma.menuItem.findFirstOrThrow({
    where: { restaurantId: restaurant.id, name: 'Fresh Lassi' },
  });

  // Line 1: plate of 3 kababs (700) + 2 naan (60) = 760
  // Line 2: 1 lassi = 150
  // Subtotal 910, delivery 69, service fee 46 → total 1025
  const subtotal = 910;
  const deliveryFee = 69;
  const serviceFee = 46;
  const totalAmount = subtotal + deliveryFee + serviceFee;
  const deliveredAt = new Date();

  // A single transaction: the order, its lines, its history and its money must
  // all land together or not at all.
  await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        orderNumber,
        customerId: customer.id,
        restaurantId: restaurant.id,
        driverId: driver.id,
        addressId: address.id,
        zoneId: address.zoneId!,
        type: OrderType.DELIVERY,
        status: OrderStatus.DELIVERED,
        deliveryLine1: address.line1,
        deliveryLandmark: address.landmark,
        deliveryLat: address.latitude,
        deliveryLng: address.longitude,
        recipientName: customer.fullName,
        recipientPhone: customer.phone,
        subtotal,
        deliveryFee,
        serviceFee,
        totalAmount,
        commissionAmount: subtotal * 0.15,
        paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
        paymentStatus: PaymentStatus.PAID,
        distanceKm: 2.4,
        preparationMinutes: 20,
        placedAt: deliveredAt,
        confirmedAt: deliveredAt,
        readyAt: deliveredAt,
        pickedUpAt: deliveredAt,
        deliveredAt,
      },
    });

    const kababLine = await tx.orderItem.create({
      data: {
        orderId: order.id,
        menuItemId: kabab.id,
        variantId: platter.id,
        nameSnapshot: kabab.name,
        variantNameSnapshot: platter.name,
        unitPrice: 700,
        quantity: 1,
        lineTotal: 760,
      },
    });

    await tx.orderItemAddOn.create({
      data: {
        orderItemId: kababLine.id,
        addOnId: naan.id,
        nameSnapshot: naan.name,
        price: 30,
        quantity: 2,
      },
    });

    await tx.orderItem.create({
      data: {
        orderId: order.id,
        menuItemId: lassi.id,
        nameSnapshot: lassi.name,
        unitPrice: 150,
        quantity: 1,
        lineTotal: 150,
      },
    });

    const transitions: [OrderStatus | null, OrderStatus, ActorType][] = [
      [null, OrderStatus.PLACED, ActorType.CUSTOMER],
      [OrderStatus.PLACED, OrderStatus.CONFIRMED, ActorType.RESTAURANT],
      [OrderStatus.CONFIRMED, OrderStatus.PREPARING, ActorType.RESTAURANT],
      [OrderStatus.PREPARING, OrderStatus.READY_FOR_PICKUP, ActorType.RESTAURANT],
      [OrderStatus.READY_FOR_PICKUP, OrderStatus.PICKED_UP, ActorType.DRIVER],
      [OrderStatus.PICKED_UP, OrderStatus.ON_THE_WAY, ActorType.DRIVER],
      [OrderStatus.ON_THE_WAY, OrderStatus.DELIVERED, ActorType.DRIVER],
    ];

    for (const [fromStatus, toStatus, actor] of transitions) {
      await tx.orderStatusHistory.create({
        data: { orderId: order.id, fromStatus, toStatus, actor },
      });
    }

    const payment = await tx.payment.create({
      data: {
        orderId: order.id,
        userId: customer.id,
        method: PaymentMethod.CASH_ON_DELIVERY,
        status: PaymentStatus.PAID,
        amount: totalAmount,
        paidAt: deliveredAt,
      },
    });

    await tx.transaction.create({
      data: {
        paymentId: payment.id,
        orderId: order.id,
        userId: customer.id,
        type: TransactionType.PAYMENT,
        status: TransactionStatus.SUCCESS,
        amount: totalAmount,
        reference: `TXN-${orderNumber}-PAYMENT`,
        description: 'Cash collected on delivery',
        processedAt: deliveredAt,
      },
    });

    await tx.transaction.create({
      data: {
        orderId: order.id,
        type: TransactionType.COMMISSION,
        status: TransactionStatus.SUCCESS,
        amount: subtotal * 0.15,
        reference: `TXN-${orderNumber}-COMMISSION`,
        description: 'Platform commission withheld from restaurant payout',
        processedAt: deliveredAt,
      },
    });

    // Credit the rider's delivery earning to their wallet.
    const riderWallet = await tx.wallet.findUniqueOrThrow({ where: { userId: driver.userId } });
    const earning = 60;
    await tx.wallet.update({
      where: { id: riderWallet.id },
      data: { balance: { increment: earning } },
    });
    await tx.walletTransaction.create({
      data: {
        walletId: riderWallet.id,
        type: WalletTransactionType.CREDIT,
        reason: WalletTransactionReason.DRIVER_EARNING,
        amount: earning,
        balanceAfter: Number(riderWallet.balance) + earning,
        referenceType: 'order',
        referenceId: order.id,
        description: `Delivery earning for ${orderNumber}`,
      },
    });

    await tx.review.create({
      data: {
        orderId: order.id,
        userId: customer.id,
        restaurantId: restaurant.id,
        driverId: driver.id,
        foodRating: 5,
        deliveryRating: 4,
        comment: 'Kababs were fresh and still hot on arrival. Will order again.',
      },
    });

    // Keep the denormalised rating aggregates consistent with the review above.
    await tx.restaurant.update({
      where: { id: restaurant.id },
      data: { rating: 5, ratingCount: 1 },
    });
    await tx.driver.update({
      where: { id: driver.id },
      data: { rating: 4, ratingCount: 1, totalDeliveries: { increment: 1 } },
    });

    await tx.notification.create({
      data: {
        userId: customer.id,
        type: NotificationType.ORDER_UPDATE,
        channel: NotificationChannel.IN_APP,
        title: 'Your order has been delivered',
        body: `Order ${orderNumber} from ${restaurant.name} was delivered. Enjoy your meal!`,
        data: { orderId: order.id },
        sentAt: deliveredAt,
      },
    });

    await tx.favorite.create({
      data: { userId: customer.id, restaurantId: restaurant.id },
    });
  });

  console.warn(`  ✓ sample order ${orderNumber} with payment, ledger, review and notification`);
}

// ═════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.warn('Seeding ZassDelivery database…\n');

  console.warn('Roles & permissions:');
  await seedRbac();

  console.warn('\nGeography:');
  await seedGeography();

  console.warn('\nUsers:');
  await seedUsers();
  await seedAddresses();

  console.warn('\nDrivers:');
  await seedDrivers();

  console.warn('\nRestaurants & menus:');
  await seedRestaurants();

  console.warn('\nPromotions & content:');
  await seedCoupons();
  await seedContent();

  console.warn('\nSample order:');
  await seedSampleOrder();

  const counts = {
    permissions: await prisma.permission.count(),
    roles: await prisma.role.count(),
    cities: await prisma.city.count(),
    zones: await prisma.zone.count(),
    deliveryFees: await prisma.deliveryFee.count(),
    users: await prisma.user.count(),
    drivers: await prisma.driver.count(),
    restaurants: await prisma.restaurant.count(),
    menuItems: await prisma.menuItem.count(),
    coupons: await prisma.coupon.count(),
    orders: await prisma.order.count(),
    settings: await prisma.setting.count(),
    faqs: await prisma.faq.count(),
  };

  console.warn('\nDone.');
  for (const [key, value] of Object.entries(counts)) {
    console.warn(`  ${key.padEnd(14)} ${value}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
