# ZassDelivery API

Food delivery platform backend serving **Pabbi**, **Nowshera** and **Peshawar**, Pakistan.

Built with NestJS 11, PostgreSQL 16 + Prisma, Redis, and TypeScript in strict mode.

---

## Status

| Milestone | Scope                                                                                               | State       |
| --------- | --------------------------------------------------------------------------------------------------- | ----------- |
| **1**     | Foundation: config, Docker, Prisma, Redis, logging, error handling, pagination, health, Swagger, CI | ✅ Complete |
| **2**     | Auth & identity — register/login, JWT access + rotating refresh, RBAC, permissions                  | ✅ Complete |
| **3**     | Users — admin CRUD, profile, addresses, favorites, notification preferences                         | ✅ Complete |
| **4**     | Restaurants — registration, approval workflow, hours, radius, categories, images, search            | ✅ Complete |
| **5**     | Menus — categories, items, variants, extra options, availability, images, inventory, bulk update    | ✅ Complete |
| **6**     | Search — full-text, food, category, nearby, trending, popular, autocomplete, Redis cache            | ✅ Complete |
| **7**     | Cart & pricing — add/remove/update, coupons, delivery fee, tax, discount, validation                | ✅ Complete |
| **8**     | Orders — placement, lifecycle state machine, timeline, refunds, invoice, transactions               | ✅ Complete |
| 9         | Dispatch & riders (Socket.IO live tracking)                                                         | Planned     |
| 10        | Payments — COD, wallet ledger, JazzCash/Easypaisa                                                   | Planned     |
| 11        | Notifications, ratings, admin analytics                                                             | Planned     |

---

## Requirements

- **Node.js** ≥ 20.11 (developed on 24.x)
- **Docker** & Docker Compose
- **npm** 11+

---

## Quick start

```bash
# 1. Configure the environment
cp .env.example .env

# 2. Start PostgreSQL and Redis
npm run docker:up

# 3. Install dependencies
npm install

# 4. Generate the Prisma client and create the schema
npm run prisma:generate
npm run prisma:deploy

# 5. Load reference data (cities, zones, seed accounts)
npm run prisma:seed

# 6. Run the API in watch mode
npm run start:dev
```

| Resource   | URL                                 |
| ---------- | ----------------------------------- |
| API base   | http://localhost:3000/api/v1        |
| Swagger UI | http://localhost:3000/api/docs      |
| Health     | http://localhost:3000/api/v1/health |

### Port note

`docker-compose.yml` publishes PostgreSQL on **5433**, not 5432, because many
machines already run a local PostgreSQL on the default port — and connecting to
the wrong one produces a confusing authentication error. Change `POSTGRES_PORT`
and the port in `DATABASE_URL` together if you prefer 5432.

Inside the Compose network the port is always 5432; the `api` service overrides
`DATABASE_URL` and `REDIS_HOST` accordingly.

---

## Running the whole stack in Docker

```bash
docker compose up -d --build
docker compose logs -f api
```

The API image applies pending migrations on boot via `docker-entrypoint.sh`
(`prisma migrate deploy`, which is idempotent and never resets data). Set
`RUN_MIGRATIONS_ON_BOOT=false` to disable that in environments where migrations
are applied by a separate release step.

---

## Testing

```bash
npm run test          # unit tests
npm run test:cov      # unit tests with coverage
npm run test:e2e      # end-to-end (requires Postgres + Redis running)
npm run lint          # ESLint
npm run typecheck     # tsc --noEmit
npm run format:check  # Prettier
```

Unit specs live beside the code they cover (`*.spec.ts`). End-to-end specs live
in `test/` and boot the real application graph against live PostgreSQL and
Redis, so they run serially.

---

## Architecture

Clean Architecture, organised by feature. Each feature module separates:

```
src/modules/<feature>/
├── domain/          # Entities, value objects, repository interfaces (no framework imports)
├── application/     # Use-cases, DTOs — orchestration only
└── infrastructure/  # Prisma repositories, external adapters
```

Dependencies point inward: infrastructure depends on domain, never the reverse.
Repository interfaces are declared in `domain/` and bound to Prisma
implementations in the module definition, which keeps use-cases testable with
plain in-memory fakes.

```
src/
├── common/          # Cross-cutting: filters, interceptors, DTOs, decorators, context
│   └── common.module.ts    # Registers the global request pipeline
├── config/          # Namespaced, validated configuration
├── infrastructure/  # Prisma (database), Redis and Winston wiring
├── shared/
│   └── shared.module.ts    # Aggregates database + cache + logger for features
└── modules/         # Feature modules
```

**`SharedModule`** bundles the backing services a feature needs (database,
cache, logger) so a feature module imports one thing instead of three.
**`CommonModule`** owns the request pipeline — filters, interceptors, guard and
middleware. `AppModule` therefore only lists _what the application contains_,
not _how a request is handled_.

`PrismaModule` is the database module; the name reflects the driver, and
replacing it would be a change confined to `SharedModule`.

### Cross-cutting behaviour

Every request passes through the same pipeline, so features do not re-implement it:

| Concern        | Mechanism                                                                   |
| -------------- | --------------------------------------------------------------------------- |
| Correlation id | `RequestContextMiddleware` + `AsyncLocalStorage`, echoed as `x-request-id`  |
| Validation     | Global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`)  |
| Errors         | `AllExceptionsFilter` — one envelope, Prisma codes mapped to HTTP semantics |
| Success shape  | `ResponseInterceptor` — uniform envelope, pagination meta hoisted           |
| Access logs    | `LoggingInterceptor` → Winston, correlated and redacted                     |
| Timeouts       | `TimeoutInterceptor` (15s default)                                          |
| Rate limiting  | `ThrottlerGuard`                                                            |

### Response format

Success:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "OK",
  "data": {},
  "meta": {
    "total": 137,
    "page": 1,
    "limit": 20,
    "totalPages": 7,
    "hasPreviousPage": false,
    "hasNextPage": true
  },
  "requestId": "3f1c0b2e-9d5a-4b3e-8f1a-2c7d6e5b4a39",
  "timestamp": "2026-08-04T09:12:33.412Z"
}
```

`meta` is present only on paginated list endpoints.

Error:

```json
{
  "success": false,
  "statusCode": 409,
  "error": "Conflict",
  "message": "A record with this phone already exists.",
  "errorCode": "UNIQUE_CONSTRAINT_VIOLATION",
  "path": "/api/v1/users",
  "requestId": "3f1c0b2e-9d5a-4b3e-8f1a-2c7d6e5b4a39",
  "timestamp": "2026-08-04T09:12:33.412Z"
}
```

`errorCode` is stable and machine-readable — branch on it rather than on
`message`. Validation failures add a `details` array of field errors.

Health probes are deliberately exempt from both envelopes and return Terminus'
native format, on success and on failure alike.

---

## API reference

Full interactive documentation at `/api/docs`. Everything below is prefixed
with `/api/v1`.

### Authentication — `/auth`

| Method | Path               | Access | Notes                                          |
| ------ | ------------------ | ------ | ---------------------------------------------- |
| POST   | `/register`        | Public | CUSTOMER or RIDER only; signs in immediately   |
| POST   | `/login`           | Public | 5 failures → 15-minute lockout, keyed by phone |
| POST   | `/refresh`         | Public | Rotates the token; replay revokes the family   |
| POST   | `/logout`          | Bearer | `allDevices` ends every session                |
| GET    | `/me`              | Bearer | Read fresh from the database, not the token    |
| POST   | `/change-password` | Bearer | Signs out every **other** session              |

Access tokens are short-lived JWTs carrying role and permission claims. Refresh
tokens rotate on every use and only their SHA-256 hash is stored, so a database
dump yields no usable sessions. Presenting an already-rotated token is treated
as theft and revokes the whole session family.

### Me — `/me`

Self-service. Ownership comes from the access token; there is no `:userId`
anywhere, so one customer cannot reach another's data.

| Method               | Path                            | Notes                                                    |
| -------------------- | ------------------------------- | -------------------------------------------------------- |
| GET / PATCH          | `/me`                           | Profile. Phone, role and status are not editable here    |
| GET / PATCH / DELETE | `/me/notification-preferences`  | Per-category channel opt-ins                             |
| GET / POST           | `/me/addresses`                 | Zone resolved from coordinates                           |
| GET / PATCH / DELETE | `/me/addresses/:id`             | 404 for someone else's address                           |
| PATCH                | `/me/addresses/:id/default`     | One default per user, enforced by a partial unique index |
| GET / POST           | `/me/favorites`                 | Restaurants or menu items                                |
| DELETE               | `/me/favorites/restaurants/:id` |                                                          |
| DELETE               | `/me/favorites/menu-items/:id`  |                                                          |

### Users (admin) — `/users`

Permission-gated rather than role-gated, so a support role can hold
`users.read` without inheriting `users.delete`.

| Method | Path                 | Permission      |
| ------ | -------------------- | --------------- |
| GET    | `/users`             | `users.read`    |
| GET    | `/users/:id`         | `users.read`    |
| POST   | `/users`             | `users.create`  |
| PATCH  | `/users/:id`         | `users.update`  |
| PATCH  | `/users/:id/status`  | `users.suspend` |
| DELETE | `/users/:id`         | `users.delete`  |
| POST   | `/users/:id/restore` | `users.update`  |

Supports `?page`, `?limit`, `?search` (name, phone, email — trigram indexed),
`?role`, `?status`, `?createdFrom`, `?createdTo`, `?sortBy`, `?sortOrder`.
A role change, suspension or deletion revokes every session immediately, since
permissions are baked into access tokens.

### Restaurants (public) — `/restaurants`

| Method | Path                      | Notes                                      |
| ------ | ------------------------- | ------------------------------------------ |
| GET    | `/restaurants`            | Search. Only approved listings             |
| GET    | `/restaurants/categories` | Cuisine categories                         |
| GET    | `/restaurants/:slug`      | Detail with images and the weekly schedule |
| GET    | `/restaurants/:id/hours`  | Includes whether open right now            |
| GET    | `/restaurants/:id/images` | Gallery                                    |

Search supports `?search` (trigram indexed), `?cityId`, `?zoneId`, `?category`,
`?priceRange`, `?minRating`, `?acceptingOnly`, and `?latitude` + `?longitude` —
which restricts results to restaurants whose **own delivery radius** reaches the
customer and adds `distanceMeters` to each row.

Each result carries **`canOrderNow`**: true only when the restaurant is
approved, accepting orders, and currently open. Clients should gate the order
button on that single flag rather than recombining the three.

### Restaurant management — `/restaurant-management`

Serves both vendors and staff; ownership is enforced inside the use-cases.

| Method               | Path                     | Access                            |
| -------------------- | ------------------------ | --------------------------------- |
| POST                 | `/`                      | Vendor owner or admin             |
| GET                  | `/mine`                  | Vendor owner — always self-scoped |
| GET                  | `/`                      | `restaurants.read` (all statuses) |
| GET / PATCH / DELETE | `/:id`                   | Owner or staff                    |
| POST                 | `/:id/approve`           | `restaurants.approve`             |
| POST                 | `/:id/reject`            | `restaurants.approve`             |
| POST                 | `/:id/resubmit`          | Owner                             |
| PATCH                | `/:id/status`            | `restaurants.suspend`             |
| PATCH                | `/:id/accepting-orders`  | Owner — pause/resume              |
| PUT                  | `/:id/hours`             | Owner — replaces the whole week   |
| POST / DELETE        | `/:id/images[/:imageId]` | Owner                             |
| PUT                  | `/:id/images/order`      | Owner — must list every image     |

#### Approval workflow

```
                 ┌─────────────────────┐
   register ───► │  PENDING_APPROVAL   │
                 └──────┬───────┬──────┘
                approve │       │ reject
                        ▼       ▼
                  ┌────────┐  ┌──────────┐
                  │ ACTIVE │  │ REJECTED │
                  └──┬───┬─┘  └────┬─────┘
       suspend ──────┘   └── temp  │ resubmit
              ▼         closure ▼  ▼
       ┌───────────┐   ┌────────────────────┐
       │ SUSPENDED │   │ TEMPORARILY_CLOSED │
       └───────────┘   └────────────────────┘
```

Transitions are declared as data, so an illegal jump (rejected straight to
active, skipping re-review) fails loudly rather than corrupting the queue.
Nothing goes live on its own: registration always lands in `PENDING_APPROVAL`,
and approval is **blocked until business hours are set**, since a restaurant
with none would be permanently "closed".

#### Business hours

Stored as local `HH:mm` in **Asia/Karachi** and compared in that timezone — a
container running in UTC would otherwise report a Peshawar restaurant closed for
five hours a day. A closing time at or before the opening time means the window
crosses midnight (`18:00`–`02:00` is a normal late-night shift). `PUT` replaces
the whole week; omitted days are stored as closed, so no stale row survives.

### Menus (public)

| Method | Path                          | Notes                                |
| ------ | ----------------------------- | ------------------------------------ |
| GET    | `/restaurants/:id/menu`       | Active menus + sections, one request |
| GET    | `/restaurants/:id/menu-items` | Searchable, filterable, sortable     |
| GET    | `/menu-items/:id`             | Variants, option groups, gallery     |
| GET    | `/menu-items/:id/images`      | Dish gallery                         |

Item filters: `?search` (trigram), `?menuCategoryId`, `?status`, `?spiceLevel`,
`?isVegetarian`, `?featuredOnly`, `?minPrice`, `?maxPrice`.

Each dish carries **`isAvailable`** plus an **`availabilityReason`** —
`available`, `hidden`, `out_of_stock`, `sold_out` or `outside_window`. Three
separate things can make a dish unorderable and a client needs to tell them
apart ("sold out" reads very differently from "not served before 11am"), so
they are not collapsed into one boolean. `effectivePrice` resolves the
discount, so clients never re-derive it.

### Menu management — `/menu-management`

| Method                | Path                                            | Notes                               |
| --------------------- | ----------------------------------------------- | ----------------------------------- |
| GET / POST            | `/restaurants/:id/menus`                        | Includes inactive menus             |
| PATCH / DELETE        | `/menus/:menuId`                                | Delete refused while items remain   |
| POST                  | `/menus/:menuId/categories`                     | Create a section                    |
| PUT                   | `/menus/:menuId/categories/order`               | Must list every section             |
| PATCH / DELETE        | `/categories/:categoryId`                       |                                     |
| GET                   | `/restaurants/:id/items`                        | Stock counts, hidden + deleted      |
| POST                  | `/items`                                        | Restaurant derived from the section |
| PATCH / DELETE        | `/items/:itemId`                                | Soft delete                         |
| POST / DELETE         | `/items/:itemId/images[/:imageId]`              | Max 8 per dish                      |
| POST / PATCH / DELETE | `/items/:itemId/variants[/:variantId]`          | Absolute prices                     |
| POST / PATCH / DELETE | `/items/:itemId/option-groups[/:groupId]`       |                                     |
| POST                  | `/items/:itemId/option-groups/:groupId/options` | Add an extra option                 |
| PATCH / DELETE        | `/items/:itemId/options/:optionId`              |                                     |
| POST                  | `/items/:itemId/stock`                          | Signed delta, applied atomically    |
| PATCH                 | `/restaurants/:id/items/bulk`                   | Reprice/restock up to 200           |
| PATCH                 | `/restaurants/:id/items/bulk-status`            | Bulk availability flip              |

#### Inventory

Stock tracking is **opt-in per dish** (`trackInventory`) — most kitchens cook to
order and never count. When enabled, adjustments go through a single
conditional `UPDATE`:

```sql
UPDATE menu_items SET stock_quantity = stock_quantity + $delta
WHERE id = $id AND stock_quantity >= abs($delta)   -- when selling
```

The guard is evaluated by Postgres inside the same statement, so two concurrent
sales cannot both pass the check and oversell the kitchen. A read-then-write
would. A `CHECK (stock_quantity >= 0)` constraint backs it up.

`?lowStockOnly=true` gives the owner's restock view, served by a partial index
covering only tracked items.

#### Bulk update

`bulk` reprices or restocks up to 200 dishes in **one transaction** — a
half-repriced menu is worse than an unchanged one. Every id is verified against
the restaurant before anything is written, _and_ `restaurantId` is repeated in
each `WHERE` as a second line of defence, so a guessed id cannot touch another
vendor's menu. `bulk-status` is the "we've run out of chicken" button: one call
instead of editing twenty dishes mid-service.

#### Invariants enforced

- A discount above the base price is rejected — it would quietly raise the price.
- Availability windows need both bounds or neither; half a window is ambiguous.
- The first variant becomes the default; the default cannot be deleted while
  others remain, or the dish would have variants with none selected.
- Option groups must be satisfiable (`minSelect ≤ maxSelect`; required implies
  `minSelect ≥ 1`), and a required group cannot be emptied — either would make
  checkout impossible.
- A dish can only be moved to a section of the **same** restaurant.

### Search — `/search`

Public discovery. All results are cached in Redis; a Redis outage degrades
these to direct database reads rather than failing the request.

| Method | Path                   | Cache TTL | Notes                                           |
| ------ | ---------------------- | --------- | ----------------------------------------------- |
| GET    | `/search`              | 2 min     | Global: 5 restaurants + 5 dishes + 5 categories |
| GET    | `/search/restaurants`  | 2 min     | Full-text, ranked                               |
| GET    | `/search/food`         | 2 min     | Full-text across all restaurants                |
| GET    | `/search/categories`   | 1 hr      | Ordered by active restaurant count              |
| GET    | `/search/nearby`       | 1 min     | Nearest first, radius-aware                     |
| GET    | `/search/trending`     | 15 min    | Delivered orders in a rolling window            |
| GET    | `/search/popular`      | 30 min    | Lifetime order counts                           |
| GET    | `/search/autocomplete` | 5 min     | Type-ahead, trigram-matched                     |

#### PostgreSQL full-text search

`restaurants` and `menu_items` each carry a `search_vector` **generated column**
with a GIN index:

```sql
setweight(to_tsvector('simple', name),        'A') ||
setweight(to_tsvector('simple', name_ur),     'A') ||
setweight(to_tsvector('simple', description), 'B')
```

Three decisions worth knowing:

- **Generated, not trigger-maintained.** Postgres recomputes the vector on every
  write, so it cannot drift out of sync the way a forgotten trigger or an
  application-side update would.
- **`'simple'`, not `'english'`.** The vocabulary is transliterated Urdu and
  Pashto — _karahi_, _chapli_, _seekh_, _biryani_. English stemming mangles
  those. `'simple'` just lower-cases and splits.
- **Weighted A/B.** A term matching a name outranks one that merely appears in a
  description.

Queries go through **`websearch_to_tsquery`**, so `"chapli kabab" -pizza` works
as written and malformed input (`&&||!`) returns results instead of a 500 —
`to_tsquery` would throw.

`ts_rank` is returned as `relevance` on every hit, and is `0` when the request
carried no search term (browsing falls back to featured → rating).

#### Autocomplete

Deliberately **not** full-text: a half-typed word is not a lexeme, and `tsquery`
matches whole ones. Suggestions use trigram similarity instead, which also
tolerates phone-keyboard typos — `kabb` still returns the Kabab dishes. An exact
prefix scores `1` so it ranks above fuzzy matches. Results mix restaurants,
dishes and categories in one list.

#### Geo

Supplying `latitude` + `longitude` limits results to restaurants that can
genuinely deliver there: the effective radius is `LEAST(requested,
restaurant.deliveryRadiusMeters)`. Coordinates must be sent as a pair — one
without the other is rejected rather than silently ignored.

`/search/nearby` rounds its cache key to ~100 m, so customers a few metres apart
share one entry instead of minting thousands of near-identical keys.

#### Trending vs popular

**Trending** counts _delivered_ orders inside a rolling window (7 days by
default) — so a newly popular place can surface. **Popular** uses lifetime order
counts broken by rating. Ranking trending on lifetime totals would leave the
same long-established names pinned to the top forever.

### Cart — `/cart`

Authenticated. Every route operates on the caller's own basket — there is no
cart id in any path, so one customer cannot reach another's.

| Method | Path              | Notes                                       |
| ------ | ----------------- | ------------------------------------------- |
| GET    | `/cart`           | Basket with full price breakdown and issues |
| POST   | `/cart/items`     | Add; identical selections merge             |
| PATCH  | `/cart/items/:id` | Update quantity; `0` removes the line       |
| DELETE | `/cart/items/:id` | Remove a line                               |
| DELETE | `/cart`           | Empty the basket                            |
| POST   | `/cart/coupon`    | Apply a code                                |
| DELETE | `/cart/coupon`    | Remove the applied coupon                   |
| PATCH  | `/cart/address`   | Set delivery address → drives fee and ETA   |
| PATCH  | `/cart/tip`       | Set the rider tip                           |
| POST   | `/cart/validate`  | Pre-checkout re-check                       |

#### Pricing engine

`PricingService` is a **pure function** — no database, no clock, no request
context. Checkout and the cart preview must agree to the paisa, and the only
way to guarantee that is for both to run the same code. It is exported from
`CartsModule` for exactly that reason.

```
total = subtotal − discount + deliveryFee + serviceFee + tax + tip
```

That formula is also the `orders_total_is_consistent` CHECK constraint, so a
mismatch is rejected by the database rather than shipped to a customer.

Decisions the engine encodes:

- **Every intermediate is rounded**, not just the total. Rounding once at the
  end lets fractional paisa drift and produces a receipt whose lines do not
  reconcile — which the CHECK constraint would then reject.
- **Fees are charged on the discounted basket**, not the list price. Billing a
  service fee on money the customer never paid is indefensible on a receipt.
- **A fixed coupon never exceeds the subtotal** — Rs. 100 off a Rs. 80 basket
  takes 80, or the total goes negative.
- **Percentage coupons respect `maxDiscountAmount`**, which is what stops
  "50% off" costing more than intended on a large order.
- **A free-delivery coupon reports zero discount when the basket already
  qualified on its own threshold.** The coupon saved nothing; claiming
  otherwise would inflate the "you saved" figure.

Line prices are read from the **live catalogue** on every request, never stored
on the cart — otherwise a customer could hold a stale price indefinitely.

#### Delivery fee

Resolved from the `delivery_fees` distance bands for the address's zone, with
the zone's flat fee as fallback. Per-km charges apply only **beyond where the
band starts**, so a 6.1 km trip is not billed as though all six kilometres were
extra. The restaurant's own `deliveryRadiusMeters` is a hard limit: no band can
make it travel further than it has said it will.

#### Validation

`POST /cart/validate` reports **every** problem at once with a stable code and a
`blocking` flag, rather than throwing on the first — so a client can show
everything that needs fixing in one pass instead of one error per round-trip.

| Code                                                              | Blocking |
| ----------------------------------------------------------------- | -------- |
| `EMPTY_CART`, `RESTAURANT_CLOSED`, `RESTAURANT_UNAVAILABLE`       | yes      |
| `ITEM_REMOVED`, `ITEM_UNAVAILABLE`, `VARIANT_UNAVAILABLE`         | yes      |
| `INSUFFICIENT_STOCK` — checked against the quantity in the basket | yes      |
| `BELOW_MINIMUM_ORDER`, `NO_ADDRESS`, `OUTSIDE_DELIVERY_AREA`      | yes      |
| `ADDON_UNAVAILABLE` — the extra is dropped, the order proceeds    | no       |
| `COUPON_INVALID` — reported, not silently ignored                 | no       |

Gate the checkout button on **`canCheckout`**.

#### Cart rules

- **One basket per customer.** Adding a dish from another restaurant _replaces_
  it — a single order cannot span two kitchens, and failing instead would leave
  the customer in a dead end.
- **Identical selections merge** into the existing line rather than stacking
  duplicates the customer must then remove one by one.
- **Option-group rules are enforced on add** — "choose a sauce" with nothing
  chosen produces an order the kitchen cannot fulfil.
- **Quantity `0` removes the line**, which is how a stepper reaching zero
  behaves; emptying the basket discards the cart so the next order elsewhere
  needs no "clear cart" prompt.
- Baskets expire after **72 hours**, extended on every edit.

### Orders — `/orders` and `/order-management`

| Method | Path                                                                 | Who                                        |
| ------ | -------------------------------------------------------------------- | ------------------------------------------ |
| POST   | `/orders`                                                            | Customer — checkout from cart              |
| GET    | `/orders`                                                            | Customer — own history, always self-scoped |
| GET    | `/orders/:id`                                                        | Any party to the order                     |
| POST   | `/orders/:id/cancel`                                                 | Customer                                   |
| GET    | `/orders/:id/timeline`                                               | Any party                                  |
| GET    | `/orders/:id/transactions`                                           | Customer + staff only                      |
| GET    | `/orders/:id/invoice`                                                | Customer + staff (not riders)              |
| POST   | `/order-management/:id/accept` · `/reject` · `/preparing` · `/ready` | Restaurant                                 |
| POST   | `/order-management/:id/pickup` · `/on-the-way` · `/delivered`        | Assigned rider                             |
| PATCH  | `/order-management/:id/status`                                       | Staff escape hatch                         |
| POST   | `/order-management/:id/refund`                                       | `payments.refund`                          |
| GET    | `/order-management` · `/restaurants/:id` · `/drivers/:id`            | Staff / vendor / rider                     |

#### Lifecycle

```
                    ┌──────────────────┐
                    │ PENDING_PAYMENT  │
                    └────────┬─────────┘
                             ▼
       ┌──── reject ──── ┌────────┐ ──── cancel ────┐
       ▼                 │ PLACED │                 ▼
  ┌──────────┐           └───┬────┘           ┌───────────┐
  │ REJECTED │               │ accept         │ CANCELLED │
  └──────────┘               ▼                └───────────┘
                       ┌───────────┐
                       │ CONFIRMED │
                       └─────┬─────┘
                             ▼  preparing
                       ┌───────────┐   ← free customer cancellation ends here
                       │ PREPARING │
                       └─────┬─────┘
                             ▼  ready
                    ┌──────────────────┐
                    │ READY_FOR_PICKUP │
                    └────────┬─────────┘
                             ▼  rider collects
                       ┌────────────┐
                       │ PICKED_UP  │
                       └─────┬──────┘
                             ▼
                      ┌─────────────┐      ┌────────┐
                      │ ON_THE_WAY  │ ───► │ FAILED │
                      └──────┬──────┘      └────────┘
                             ▼
                       ┌───────────┐
                       │ DELIVERED │  (terminal)
                       └───────────┘
```

Transitions are declared as **data**, and each carries the set of actors
permitted to make it. Both halves are enforced: the move must be legal _and_
the caller must be entitled to it. A customer cannot mark their own order
delivered; a rider cannot accept one for the kitchen; only the **assigned**
rider can progress a delivery. Terminal orders never move again — corrections
are made through refunds, which leave their own audit trail rather than
rewriting history.

`GET /orders/:id` returns `allowedTransitions` filtered to _your_ role, so a
client renders its action buttons straight from the response.

#### Placement

`POST /orders` re-validates and re-prices the basket server-side; nothing about
the total comes from the client. One transaction writes the order, its lines and
add-ons, the opening timeline entry, the payment row, **stock decrements**,
coupon accounting, and clears the cart. A half-written order is worse than a
failed checkout, because nobody can tell what the customer actually bought.

Stock is claimed with a conditional `UPDATE ... WHERE stock_quantity >= n`
inside that same transaction, so two simultaneous checkouts cannot both take the
last unit — the loser's whole order rolls back.

Order numbers (`ZD-260804-0001`) come from a Postgres **sequence**, not a row
count: two checkouts in the same millisecond would otherwise compute the same
number and one would fail at random on the unique index.

#### Money

- **Cash on delivery** is recorded `PENDING` and settles the moment the order is
  marked delivered — that is when the rider actually collects it.
- **Wallet** payments debit inside the placement transaction; an insufficient
  balance rolls the order back rather than leaving one nobody paid for.
- **Commission** is taken on the food value alone. A cut of the delivery fee,
  service fee or tip would bill the kitchen for money it never sees.
- **Refunds are additive**, not a status change: a delivered order stays
  delivered. Partial refunds accumulate, can never exceed what was paid, and
  credit the customer's wallet with a matching ledger entry.

#### Stock restoration

Returned only when the order ends before the kitchen committed — `PENDING_PAYMENT`,
`PLACED` or `CONFIRMED`. Once cooking has started the ingredients are gone, and
restocking would overstate what is actually available.

---

## Data model

49 tables across eleven domains. `User` and `Order` are the two hubs: almost
every table reaches one of them within a single hop.

```mermaid
erDiagram
    USER ||--o{ ADDRESS : "saves"
    USER ||--o| WALLET : "owns"
    USER ||--o| DRIVER : "may be"
    USER ||--o{ RESTAURANT : "owns"
    USER ||--o{ ORDER : "places"
    USER }o--o{ ROLE : "assigned"
    ROLE }o--o{ PERMISSION : "grants"

    CITY ||--o{ ZONE : "contains"
    ZONE ||--o{ DELIVERY_FEE : "priced by"
    ZONE ||--o{ ADDRESS : "covers"
    ZONE ||--o{ RESTAURANT : "hosts"
    ZONE ||--o{ DRIVER : "home zone"

    RESTAURANT ||--o{ RESTAURANT_IMAGE : "has"
    RESTAURANT ||--o{ RESTAURANT_HOUR : "opens"
    RESTAURANT }o--o{ RESTAURANT_CATEGORY : "listed under"
    RESTAURANT ||--o{ MENU : "publishes"
    MENU ||--o{ MENU_CATEGORY : "groups"
    MENU_CATEGORY ||--o{ MENU_ITEM : "lists"
    MENU_ITEM ||--o{ MENU_VARIANT : "sized by"
    MENU_ITEM ||--o{ ADD_ON_GROUP : "offers"
    ADD_ON_GROUP ||--o{ ADD_ON : "contains"

    DRIVER ||--o{ VEHICLE : "drives"
    DRIVER ||--o{ ORDER : "delivers"
    RESTAURANT ||--o{ ORDER : "fulfils"

    ORDER ||--|{ ORDER_ITEM : "contains"
    ORDER_ITEM ||--o{ ORDER_ITEM_ADD_ON : "with"
    ORDER ||--o{ ORDER_STATUS_HISTORY : "trail"
    ORDER ||--o{ PAYMENT : "paid by"
    PAYMENT ||--o{ TRANSACTION : "ledger"
    ORDER ||--o| REVIEW : "rated by"
    ORDER ||--o| COUPON_REDEMPTION : "used"
    COUPON ||--o{ COUPON_REDEMPTION : "redeemed"
    WALLET ||--o{ WALLET_TRANSACTION : "ledger"

    USER ||--o{ FAVORITE : "saves"
    USER ||--o{ NOTIFICATION : "receives"
    USER ||--o{ SUPPORT_TICKET : "opens"
    SUPPORT_TICKET ||--o{ SUPPORT_TICKET_MESSAGE : "thread"
    USER ||--o{ AUDIT_LOG : "acts"
```

### Domains

| Domain            | Tables                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| Identity & access | `users`, `roles`, `permissions`, `role_permissions`, `user_role_assignments`                                       |
| Geography         | `cities`, `zones`, `delivery_fees`, `addresses`                                                                    |
| Restaurants       | `restaurants`, `restaurant_categories`, `restaurant_category_assignments`, `restaurant_images`, `restaurant_hours` |
| Menu              | `menus`, `menu_categories`, `menu_items`, `menu_variants`, `add_on_groups`, `add_ons`                              |
| Delivery          | `drivers`, `vehicles`                                                                                              |
| Orders            | `orders`, `order_items`, `order_item_add_ons`, `order_status_history`                                              |
| Money             | `payments`, `transactions`, `wallets`, `wallet_transactions`, `coupons`, `coupon_redemptions`                      |
| Engagement        | `favorites`, `reviews`, `notifications`                                                                            |
| Operations        | `support_tickets`, `support_ticket_messages`, `audit_logs`                                                         |
| Content           | `banners`, `settings`, `faqs`                                                                                      |

### Design rules

- **Money** is `Decimal(10,2)` (`Decimal(12,2)` for wallet and ledger balances);
  **coordinates** are `Float`. Never store currency as a float.
- All timestamps are `Timestamptz(3)`.
- **Orders snapshot everything they depend on** — item names, variant names,
  unit prices, the delivery address and the coupon code. Menus and addresses
  change constantly; a historical order must not change with them. Foreign keys
  to menu items are `SetNull`, so deleting a dish never rewrites past orders.
- **Ledgers are append-only.** `transactions` and `wallet_transactions` are never
  updated; corrections are posted as new rows. `transactions.reference` is unique,
  which makes a replayed gateway webhook a no-op instead of a double credit.
- **Denormalised aggregates** (`restaurants.rating`, `drivers.rating`,
  `orders.paymentStatus`) exist because listings sort and filter on them; they are
  recomputed on write rather than joined on every read.
- `User`, `Address`, `Restaurant`, `MenuItem` and `Driver` are **soft-deleted**
  via `deletedAt`; read paths must filter it.

### Constraints and indexes beyond Prisma's schema language

Hand-written in `20260804053000_full_platform_schema`, because the schema
language cannot express them:

- **18 CHECK constraints** — order totals must equal their components; ratings
  must be 1–5; percentage coupons cannot exceed 100%; add-on `minSelect` must not
  exceed `maxSelect`; a favorite must reference exactly one target; money is
  never negative. The application validates these too, but a constraint is what
  holds under concurrent writes and manual SQL.
- **GIN trigram indexes** on `restaurants.name`, `menu_items.name`,
  `users.full_name` and `users.phone`, backing `?search=`. A btree index cannot
  serve a leading-wildcard `ILIKE '%term%'`.
- **Partial indexes** on the hot paths: browsable restaurants, orderable menu
  items, dispatchable riders, in-flight orders, unread notifications — plus
  partial _unique_ indexes for one default address per user and one primary
  vehicle per driver.

> Prisma cannot represent trigram indexes in the datamodel, so `migrate diff`
> proposes dropping them on every run. Strip those `DROP INDEX` lines when
> generating a new migration.

### Seeded data

| Phone           | Role                                                    |
| --------------- | ------------------------------------------------------- |
| `+923000000001` | `SUPER_ADMIN` (all 51 permissions)                      |
| `+923000000002` | `ADMIN`                                                 |
| `+923001234567` | `CUSTOMER` — default Pabbi address, one delivered order |
| `+923009876543` | `RIDER` — motorcycle `PES-4821`                         |
| `+923005551234` | `VENDOR_OWNER` — Chapli Kabab House                     |

Also seeded: 6 roles · 51 permissions · 3 cities · 9 zones · 27 delivery-fee
bands · 3 restaurants with menus · 10 menu items · 3 coupons · 10 settings ·
5 FAQs · and one fully delivered order with its payment, ledger entries, wallet
movement, review and notification.

The seed is idempotent — every write is an upsert on a natural key.

---

## Configuration

All environment variables are declared in `src/config/env.validation.ts` and
validated at boot. A malformed environment **aborts startup** with every problem
listed at once, rather than failing later at the first request that needs the
value. See `.env.example` for the full set.

Configuration is exposed as typed namespaces:

```ts
constructor(
  @Inject(appConfig.KEY) private readonly config: ConfigType<typeof appConfig>,
) {}
```

---

## Database workflow

```bash
npm run prisma:migrate   # create + apply a migration in development
npm run prisma:deploy    # apply pending migrations (non-interactive; CI/production)
npm run prisma:studio    # browse data
npm run db:reset         # DESTRUCTIVE: drop, re-migrate, re-seed
```

Use `prisma:deploy` in any script or pipeline. `prisma migrate dev` is
interactive and can block waiting for input.

---

## Version pins

Some dependencies are deliberately held back from the newest release:

- **Prisma 6.19.3** — Prisma 7 requires a new `prisma.config.ts` and no longer
  auto-loads `.env`. Deferred until the migration is scheduled deliberately.
- **TypeScript 5.9.3** — `ts-jest` requires `typescript >=4.3 <7`; TypeScript 7
  would break the test toolchain.
- **ioredis 5.11.1** — 6.0.0 is a very recent major on critical infrastructure.

`package.json` also carries an `allowScripts` block. npm 11 blocks install
scripts by default; Prisma's engine download is one of them, so the approval is
committed to keep local, CI and Docker installs identical.

---

## Git hooks

Husky installs on `npm install` via the `prepare` script.

| Hook         | Action                                                           |
| ------------ | ---------------------------------------------------------------- |
| `pre-commit` | `lint-staged` — ESLint `--fix` and Prettier on staged files only |
| `commit-msg` | `commitlint` — enforces Conventional Commits                     |

Commit messages must follow `type(scope): subject`, for example:

```
feat(auth): add phone OTP verification
fix(orders): correct delivery fee for Risalpur zone
```

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`,
`build`, `ci`, `chore`, `revert`. This keeps automated changelogs and semantic
version bumps possible without rewriting history later.

The hooks intentionally do **not** run the full test suite — a slow commit is a
bypassed commit. CI owns tests, typecheck and the build.

---

## Graceful shutdown

On `SIGTERM`/`SIGINT` the application stops accepting connections, lets in-flight
requests finish, then closes Prisma and Redis through their `onModuleDestroy`
hooks. A failsafe timer (`shutdownTimeoutMs`, default 10s) forces exit if a hung
dependency would otherwise leave the container un-killable.

HTTP keep-alive is set to 65s — longer than a typical load balancer idle timeout,
so the balancer cannot reuse a socket the server is already closing and surface
sporadic 502s.

---

## CI

`.github/workflows/ci.yml` runs three jobs on every push and pull request:

1. **quality** — format check, lint, typecheck, unit tests with coverage
2. **e2e** — end-to-end suite against service containers for PostgreSQL and Redis
3. **build** — compile, then build the production Docker image
