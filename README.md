# RunLayer

Weather-driven running outfit recommendations based on real-time conditions and personal preferences.

## Problem

Runners often rely on generic weather advice or guesswork when choosing what to wear. Temperature alone does not account for factors such as humidity, wind, workout intensity, terrain, or individual preferences.

RunLayer solves this problem by combining real-time weather data, personal runner profiles, and a rule-based recommendation engine to generate personalized running outfit recommendations.

## Overview

RunLayer helps runners make smart gear decisions by combining:
- **Real-time weather data** for your location
- **Personal profile factors** (body type, heat sensitivity, chafe preferences, style)
- **Curated gear database** with weather suitability tags
- **Smart recommendation engine** that matches conditions to optimal outfits

## Key Features

- **Weather-Aware Recommendations** — Uses weather conditions like temperature, humidity, rain, wind, and UV to recommend running outfits.
- **Personalized Runner Profiles** — Stores user preferences such as heat sensitivity, budget, terrain, fit, and style.
- **Rule-Based Recommendation Engine** — Scores gear using weather, workout type, intensity, terrain, budget, and brand affinity.
- **Recommendation Explanations** — Shows why each item was recommended with score breakdowns and reasoning.
- **Saved Outfits & Kits** — Lets users save race-day, cold-weather, tempo, and custom outfit collections.
- **Recommendation History** — Tracks past recommendations for review and personalization.
- **Feedback System** — Users can rate recommendations to improve future suggestions.
- **Gear Comparison View** — Compare multiple gear items side-by-side.
- **Admin Gear Management** — Admin dashboard for creating, editing, importing, and managing gear.
- **Analytics Dashboard** — Tracks recommendation patterns, brand trends, weather usage, and feedback insights.

## Technical Highlights

- Built a modular recommendation engine using pluggable scorers and filters.
- Implemented recommendation versioning for experimentation and analytics.
- Designed repository and service layers to separate business logic from API routes.
- Built recommendation explanations and score breakdowns for transparency.
- Added recommendation history, feedback tracking, and analytics dashboards.
- Developed a gear comparison system and saved kit collections.

## Architecture

Request Flow

User
  ↓
Recommendation Form
  ↓
/api/recommendation
  ↓
Recommendation Service
  ↓
Recommendation Engine
  ↓
Scorers + Filters
  ↓
Prisma Repository Layer
  ↓
PostgreSQL (Supabase)

External Services:
- Weather API

## Recommendation Engine

RunLayer uses a rule-based recommendation engine.

Recommendations are generated through:

1. Weather filtering
2. Category filtering
3. User preference matching
4. Brand affinity scoring
5. Budget scoring
6. Terrain scoring
7. Weather scoring
8. Rotation penalties to reduce repetitive recommendations

Each recommendation returns:
- Recommended items
- Score breakdown
- Explanation reasons
- Recommendation engine version metadata

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | [Next.js 16](https://nextjs.org) (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 |
| UI Components | Radix UI + `class-variance-authority` + `tailwind-merge` |
| Database | Supabase (PostgreSQL) + Prisma ORM 5 |
| Validation | Zod |
| State | Zustand
| Fonts | Geist (Vercel) |

## Database Schema

Core entities:
- **User** — Authentication & basic info
- **UserProfile** — Running preferences & body characteristics
- **Gear** — Apparel items with weather/body tags
- **Brand** — Brand metadata (tier, style)
- **Category** - Gear categories
- **Recommendation** — Generated outfit suggestions
- **RecommendationItem** - Individual items within a recommendation
- **UserSavedOutfits** — Favorited recommendations
- **Weather** — Cached weather condition snapshots

## API Routes

### Authentication

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/auth` | Check current authentication status |
| `POST` | `/api/auth/signup` | Register a new user |
| `POST` | `/api/auth/login` | Log in an existing user |
| `POST` | `/api/auth/logout` | Log out current user |

### Weather

| Method | Route | Description | Query |
|--------|-------|-------------|-------|
| `GET` | `/api/weather` | Fetch current weather for a location (**requires a signed-in user**) | `?location=Boston,%20MA` |

`/api/weather` returns `401` without a session. The `location` is trimmed and normalized (Unicode NFC, single spaces, `", "` after commas) and must be 1-120 characters of letters, digits, spaces and `, . ' ’ ( ) -`; anything else returns `400` (`Missing location`, `Location is too long` or `Location contains invalid characters`) without calling the weather provider. Each user is limited to 30 requests per minute (`WEATHER_RATE_LIMIT` in `lib/weather/weatherRequest.ts`), keyed by the authenticated user id (never by client IP or forwarded headers); excess requests return `429` in the same shape as the other rate-limit responses. If the Upstash backend is unavailable, a bounded in-memory limiter keeps enforcing the same per-user limit, so the provider quota stays protected and weather stays available. The trade-off is that this fallback is per process, so with several instances the effective limit during an outage is up to 30 per user per instance per minute. There is no server-side weather cache.

### Recommendations

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/recommend` | Generate a personalized outfit recommendation |
| `GET` | `/api/recommendations/history` | Get recommendation history |
| `GET` | `/api/recommendations/history/[id]` | Get one recommendation history record |
| `DELETE` | `/api/recommendations/history/[id]` | Delete one recommendation history record |
| `POST` | `/api/recommendation/feedback` | Submit feedback for a recommendation |

### Gear Catalog

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/gear` | List gear items |
| `GET` | `/api/admin/gear` | List gear items for admin management |
| `POST` | `/api/admin/gear` | Create a gear item |
| `GET` | `/api/admin/gear/[id]` | Get one gear item |
| `PUT` | `/api/admin/gear/[id]` | Update one gear item |
| `DELETE` | `/api/admin/gear/[id]` | Delete one gear item |
| `POST` | `/api/admin/gear/import` | Bulk import gear items |
| `GET` | `/api/admin/brands` | List brands |
| `POST` | `/api/admin/brands` | Create a brand |

### Saved Outfits

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/outfit/save` | Get saved outfits for the current user |
| `POST` | `/api/outfit/save` | Save an outfit |
| `GET` | `/api/outfit/[id]` | Get one saved outfit |
| `DELETE` | `/api/outfit/[id]` | Delete one saved outfit |

### User Profile

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/profile` | Get the current user profile |
| `PUT` | `/api/profile` | Update or create the current user profile |

### Dashboard & Observability

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/dashboard` | Get dashboard summary data |
| `GET` | `/api/metrics` | Expose Prometheus metrics |


## Project Structure

```txt
├── app/                         # Next.js App Router routes and API endpoints
│   ├── api/                     # Auth, weather, gear, profile, recommendation, saved outfit APIs
│   ├── admin/                   # Admin analytics and gear management pages
│   ├── dashboard/               # User dashboard, profile, history, insights, saved outfits
│   ├── auth/                    # Login and signup pages
│   ├── recommendation/          # Recommendation UI
│   └── layout.tsx               # Root layout
├── components/                  # Reusable React components
│   ├── admin/                   # Admin gear and analytics components
│   ├── auth/                    # Login/signup forms
│   ├── compare/                 # Gear comparison UI
│   ├── dashboard/               # Dashboard client components
│   ├── layout/                  # Navbar, sidebar, app shell
│   ├── profile/                 # Runner profile form
│   ├── recommendation/          # Outfit cards, explanations, feedback, insights
│   ├── saved/                   # Saved outfit/kit components
│   └── ui/                      # Shared UI primitives
├── config/                      # Environment, scoring, weather rules, engine version config
├── content/gear/                # Seed gear data JSON files
├── context/                     # Auth context provider
├── docs/                        # Project documentation
├── grafana/                     # Grafana dashboards and provisioning
├── hooks/                       # Custom React hooks
├── lib/                         # Core application logic
│   ├── auth/                    # Auth helpers
│   ├── db/                      # Prisma repositories
│   ├── engine/                  # Recommendation filters, scorers, rankers, builders
│   ├── http/                    # API error and validation helpers
│   ├── ingestion/               # Gear import parsing, mapping, validation
│   ├── recommendations/         # Recommendation service/types/run type data
│   ├── validation/              # Zod schemas
│   └── weather/                 # Weather client and normalizer
├── prisma/                      # Prisma schema, migrations, and seed scripts
├── public/                      # Static assets
├── scripts/                     # Utility scripts
├── services/                    # Server/client business service layer
├── store/                       # Zustand preference, UI, and user stores
├── package.json                 # Scripts and dependencies
└── docker-compose.observability.yml
```

## Getting Started

1. **Install dependencies:**
   \`\`\`bash
   npm install
   \`\`\`

2. **Set up a local database and seed it** (see [Seeding safely](#seeding-safely) first). The seed commands only ever run against a dedicated database on this machine, never against a hosted one:

   ```bash
   createdb runlayer_dev                      # a local database whose name starts with "runlayer"
   DATABASE_URL="postgresql://localhost:5432/runlayer_dev" npx prisma migrate deploy
   # create .env.seed.local (see below), then:
   npm run db:seed:check                      # read-only: shows whether seeding would be allowed
   npm run db:seed:local
   ```

3. **Run the development server:**
   \`\`\`bash
   npm run dev
   \`\`\`

4. Open [http://localhost:3000](http://localhost:3000)

## Environment Setup

Copy the template and fill in your own values (`.env` is git-ignored; `.env.example` contains placeholders only):

```bash
cp .env.example .env
```

```env
# Required
DATABASE_URL=
BETTER_AUTH_SECRET=
WEATHER_API_KEY=

# Required in production, optional in development (defaults to "memory")
RATE_LIMIT_BACKEND=

# Required in production, optional in development (defaults to "none")
CLIENT_IP_STRATEGY=

# Optional. Enables GET /api/metrics outside development (see notes)
METRICS_TOKEN=

# Required only when RATE_LIMIT_BACKEND=upstash
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Optional
REDIS_URL=
LOG_LEVEL=
RECOMMENDATION_DEBUG=
```

> **Notes**
>
> - `DATABASE_URL` is required for Prisma and PostgreSQL.
> - `BETTER_AUTH_SECRET` signs session cookies. Under `npm run dev` (`NODE_ENV=development`) it is optional and a publicly known fallback is used. In every other environment it is required, must be at least 32 characters, and must not be the development fallback. Generate one with `openssl rand -base64 48` and use a different value per environment.
> - **Sessions and revocation.** A session cookie holds a signed token `userId.sessionVersion.expiresAt.signature` valid for 7 days. A token is accepted only while its `sessionVersion` equals the user's stored `users.session_version`. Logging out increments that value in one atomic `UPDATE ... WHERE id = ? AND session_version = ?`, which ends **every** session of that user ("log out everywhere"); replaying an old cookie afterwards is rejected, a stale cookie cannot revoke newer sessions, and repeating a logout changes nothing. If the revocation itself fails, the cookie is still cleared but `/api/auth/logout` returns HTTP 500 instead of claiming success. Role changes still apply immediately. Earlier three-part tokens are rejected, so everyone signs in again after upgrading. **`proxy.ts` only checks the signature and expiry, so it does not establish that a session is still valid;** revocation is enforced by `requireAuth`/`requireAdmin`/`getSessionUser` on every protected page and API route. **Deployment order:** apply the `add_user_session_version` migration (`npm run db:deploy`) *before* deploying code that selects the column; to roll back, revert the code first, then optionally `ALTER TABLE "users" DROP COLUMN "session_version";`.
> - `WEATHER_API_KEY` is the OpenWeather API key used for weather lookups.
> - `REDIS_URL` is optional and is used only as a response cache for `POST /api/recommend`. If Redis is unavailable, RunLayer runs without the cache. It does **not** enable rate limiting.
> - `RATE_LIMIT_BACKEND` selects the rate limiter: `memory` or `upstash`. It defaults to `memory` outside production. In production it is **required**; an unset, unknown, or incomplete value is rejected (API requests fail with an error rather than running unprotected).
> - **The `memory` backend is process-local.** Each server process keeps its own counters, they reset on restart, and they are not shared across instances (a fixed window can also allow up to 2x the limit across a window boundary). It is not equivalent to distributed rate limiting and is not sufficient for a multi-instance production deployment. Use `upstash` for that. Its table is capped at 10,000 keys per limiter; when full, the oldest entries are evicted.
> - `CLIENT_IP_STRATEGY` controls how the client IP used for rate limiting is determined: `none`, `header:<name>` or `xff-hops:<n>`. It defaults to `none` outside production and is **required** in production (unset or invalid values are rejected). Forwarding headers are client-controlled unless a proxy you operate overwrites or appends to them, so none is trusted by default:
>   - `none` reads no header. All clients share one identifier (`unknown`) and therefore one rate-limit bucket. For the general API limiter in production this means one client can exhaust the limit for everyone, so `none` is only appropriate for local development or single-user use. Login and signup skip their per-IP limit under `none` (see below) so users cannot lock each other out.
>   - `header:<name>` trusts one single-address header. Use it **only** if a hosting proxy sets and overwrites that header on every request and clients cannot reach the app without passing through that proxy.
>   - `xff-hops:<n>` uses the n-th entry from the right of `X-Forwarded-For`. Use it **only** after verifying the proxy chain: exactly `n` trusted proxies must each append the address they saw. Entries to the left of that position are client-controlled and are ignored.
>   - Values that are not a valid bare IPv4/IPv6 address (ports, brackets, lists, oversized values) resolve to `unknown`. Next.js only fills `X-Forwarded-For` from the socket when the header is absent, so a client-supplied value is preserved; this is why nothing is trusted without an explicit strategy. IP addresses are not written to application logs.
> - **Login and signup throttling.** Each request must pass every layer that applies, all checked before password hashing and account creation. Starting values are constants in `lib/rateLimit/authThrottle.ts` (`AUTH_RATE_LIMITS`):
>   - a shared **flood guard** for all clients (login 60/min, signup 10/min). One determined flood can exhaust it and block everyone until the window ends; that is the cost of a global guard;
>   - a **per-IP** limit (login 5/min, signup 5/hour), applied only when `CLIENT_IP_STRATEGY` yields a trusted IP;
>   - a **per-account** limit (login 10 per 15 minutes, signup 3 per hour) keyed by an HMAC-SHA256 of the normalized email (keyed with `BETTER_AUTH_SECRET`; the plaintext address is never a limiter key or logged). It applies identically whether or not the account exists.
>
>   All use fixed windows, so a lockout always expires on its own and denied attempts never extend it. However, anyone can still keep a *known* address locked out by repeating attempts every window, and the same limits apply when Upstash is down (a bounded in-memory limiter takes over). Every denial returns the same `429` body and headers whichever layer triggered it. Account enumeration through signup (`409 DUPLICATE_EMAIL`) and through login timing is **not** addressed by throttling; throttling only bounds how fast it can be done.
> - `METRICS_TOKEN` protects `GET /api/metrics`, which requires `Authorization: Bearer <METRICS_TOKEN>` whenever the token is set. It is server-side only (never use a `NEXT_PUBLIC_` prefix). Unset, the endpoint is **open only when `NODE_ENV=development`** (so the local Prometheus/Grafana workflow needs no setup) and returns `404` in every other environment, including production and staging. A token that is set but invalid (it must be 32-256 characters of letters, digits and `- . _ ~ + /`, optionally ending in `=`) also returns `404`, so a bad value can never expose metrics. Generate one with `openssl rand -base64 48`. The check uses only the `Authorization` header and never the client IP.
>   - **Local observability:** with `METRICS_TOKEN` unset and `npm run dev`, `docker compose -f docker-compose.observability.yml up` works as before. To scrape with a token (or to scrape a production-mode `next start`), write the token to the git-ignored `secrets/metrics_token` file and add the overlay: `METRICS_TOKEN_FILE=./secrets/metrics_token docker compose -f docker-compose.observability.yml -f docker-compose.observability.auth.yml up` (see the comments in that file).
>   - The general API rate limiter in `proxy.ts` still runs before this check, so unauthenticated traffic counts against the shared API limit.
> - `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are used only when `RATE_LIMIT_BACKEND=upstash`, which requires both. Setting them alone does not enable Upstash.
> - If Upstash errors at runtime, the login limiter falls back to a bounded in-memory limiter, and the global and recommendation limiters fail open (requests are not throttled). Every such event is counted in the `runlayer_rate_limit_backend_events_total` metric and logged at error level, rate-limited to once a minute per limiter.
> - Because rate limiting now defaults to `memory` in development, a high-volume local script (for example the k6 load test, whose 20 virtual users share one client IP) can receive `429` responses that it did not receive before.
> - `LOG_LEVEL` sets the Winston log level (default `info`). `RECOMMENDATION_DEBUG=true` prints recommendation-engine diagnostics (always on in development).
> - Never commit `.env` files or real credentials, tokens, or session cookies.

## Seeding safely

The seed (`prisma db seed`, the individual files in `prisma/seeds/`, and `scripts/importGear.ts`) can only run against a **dedicated local database**. There is no force flag and no override. Before anything is written it requires **all** of the following:

- `NODE_ENV` is not `production`, and no hosting-provider environment is detected.
- `DATABASE_URL` points at this machine: `localhost`, `127.x.x.x`, `::1`, or a local Unix socket (`?host=/absolute/path`). Hosted providers (Supabase, Neon, RDS, ...), LAN addresses, Docker service names, alternate spellings of loopback, and connection-string tricks (extra `@`, multiple hosts, `hostaddr=`/`host=` redirects, ...) are rejected.
- The database name starts with `runlayer` (for example `runlayer_dev`), and `RUNLAYER_SEED_CONFIRM_DATABASE` is set to that exact name.
- After connecting, the server itself must report the same database name, a loopback address and the same port, one read-only query. This catches a `localhost` URL that is really an SSH tunnel or port-forward to a hosted database. If the identity cannot be verified, nothing runs.
- `SEED_USER_PASSWORD` is set (12-128 characters, not a common or predictable password, not containing the account email). There is no default password.

Seeding is **create-only**: an existing account (its password and profile), an existing catalog item (including admin edits and variants), and an existing demo outfit are left exactly as they are, so repeating it is safe. The demo account is `user@example.com`; it is never an administrator.

**Seed versus import.** `npm run db:seed` is **create-only**: it adds missing demo data and never modifies an existing account, profile, catalog item (including its variants and admin edits) or outfit. `scripts/importGear.ts` is an **updating** utility: for each item in `content/gear/*.json` whose name and brand match an existing item, it overwrites that item's fields and **replaces all of its variants** on every run. Both run only against a confirmed, dedicated local database and share the same safety checks (`--force` does not exist). The two catalogs currently do not overlap (78 seed items, 3 import items), so running both is additive today. To load or change a catalog in a hosted environment, use the authenticated admin import.

**Brand resolution in the catalog import.** A catalog row names its brand (`brand`) and may also carry an explicit database id (`brandId`). The import never writes a brand name into `gear_items.brand_id`; every row is resolved to a real `brands.id` first:

- A `brand` name is matched to an existing brand ignoring case, surrounding/repeated whitespace and Unicode compatibility forms (`nike` reuses `Nike`). If none exists, **`scripts/importGear.ts` creates it**, keeping the name as supplied (trimmed, whitespace collapsed). The authenticated admin import (`POST /api/admin/gear/import`) **never creates brands**: an unknown brand rejects that row.
- An explicit `brandId` must be an existing brand id and never creates anything. A `brandId` combined with a `brand` name that belongs to a different brand is rejected, and a name shared by several existing brands (for example `Nike` and `NIKE`) is rejected as ambiguous.
- Bad rows (wrong types, blank, over 100 characters, control characters) fail individually with a fixed reason; they never abort the import and never create a brand. Failure reasons are fixed strings, not raw database errors.
- Brand lookup and creation run in one short transaction that holds a PostgreSQL advisory lock, so concurrent imports do not create duplicate brands. The lock only coordinates importers that use it: a brand created through another path (such as the admin "create brand" endpoint) does not take it, and the database's unique index on `brands.name` is case-sensitive, so two such writers could still create `Nike` and `nike`; a later import then reports that brand as ambiguous instead of guessing.
- **Not all-or-nothing.** Brands are committed before items are written, and each gear item is then written atomically (the item and its variants together) while the batch as a whole is best-effort: a failed item is reported and does not roll back the others or the brands. Brands created for a run that later fails remain and are reused by the next run. If two imports create the same item at once, the loser re-reads the current item and updates it once; any other conflict is reported as `conflicting concurrent write`.

An opt-in integration test (`lib/ingestion/importGear.integration.test.ts`) exercises this against a disposable local PostgreSQL database; see the header of that file.

**Recommended workflow.** Keep seed settings out of `.env` (which may point at a hosted database). Create a git-ignored `.env.seed.local`:

```env
DATABASE_URL=postgresql://localhost:5432/runlayer_dev
RUNLAYER_SEED_CONFIRM_DATABASE=runlayer_dev
SEED_USER_PASSWORD=<a strong password you choose>
```

Then run `npm run db:seed:check` and `npm run db:seed:local`. Variables already set in your shell win over both files, and `db:seed:check` accounts for that. The check cannot verify the server's identity (that needs a connection); the seed does.

**These Prisma commands are not protected by this guard:** `prisma migrate dev`, `prisma migrate reset` (which drops all data and then runs the seed) and `prisma db push` act on whatever `DATABASE_URL` is set. Always set `DATABASE_URL` explicitly for them, as above, and use `prisma migrate deploy` (non-destructive) for hosted databases. To load the catalog into a hosted environment use the authenticated admin import, not the scripts.

## Scripts

| Command | Description |
|---------|-------------|
| \`npm run dev\` | Start development server |
| \`npm run build\` | Production build |
| \`npm run start\` | Start production server |
| \`npm run lint\` | Run ESLint |
| \`npm run db:seed\` | Seed using the `DATABASE_URL` in `.env`. **Refused unless that is a confirmed, dedicated local database** (a hosted `.env` is rejected). |
| \`npm run db:seed:local\` | Seed using `.env.seed.local` (the recommended workflow below) |
| \`npm run db:seed:check\` | Read-only report of whether the seed commands would be allowed. Makes **no database connection**. |
| \`npm run postinstall\` | Automatically generates Prisma client after install |

## Deployment Readiness

- Production build passes
- ESLint passes
- Test suite passes: 14/14
- Prisma Client generates successfully
- Redis gracefully degrades when unavailable
- Weather, auth, recommendations, saved outfits, and history smoke tested

## Future Enhancements

- AI-assisted outfit recommendations
- Better Auth integration for secure authentication and session management
- Google OAuth sign-in
- Persistent user accounts and profile synchronization
- Training plan integrations
- Strava integration
- Gear rotation tracking
- Affiliate marketplace integrations
- Mobile application
- Historical weather trend analysis
- Machine-learning ranking experiments

## Development Notes

- This project uses **Next.js 16** with breaking changes from previous versions. See [AGENTS.md](./AGENTS.md).
- Weather rules and brand configs are defined in [\`config/\`](./config/)
- Recommendation logic lives in [\`lib/engine/\`](./lib/engine/)
- Custom hooks in [\`hooks/\`](./hooks/) handle data fetching with caching


Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
