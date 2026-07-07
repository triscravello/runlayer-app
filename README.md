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
| `GET` | `/api/weather` | Fetch current weather for a location | `?location=Boston,%20MA` |

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

2. **Set up the database:**
   \`\`\`bash
   npx prisma migrate dev
   npx prisma db seed
   \`\`\`

3. **Run the development server:**
   \`\`\`bash
   npm run dev
   \`\`\`

4. Open [http://localhost:3000](http://localhost:3000)

## Environment Setup

Create a `.env` file in the project root with the following variables:

```env
# PostgreSQL / Prisma
DATABASE_URL=

# Application
AUTH_SECRET=
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Redis (optional)
REDIS_URL=

# Optional (only if using Upstash Redis instead of ioredis)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

> **Notes**
>
> - `DATABASE_URL` is required for Prisma and PostgreSQL.
> - `AUTH_SECRET` is required for signing authentication tokens.
> - `NEXT_PUBLIC_APP_URL` should point to your application URL (for local development: `http://localhost:3000`).
> - `REDIS_URL` enables caching and rate limiting. If Redis is unavailable, RunLayer gracefully falls back to operating without cache.
> - Only configure the Upstash variables if you're using Upstash Redis instead of a standard Redis server.

## Scripts

| Command | Description |
|---------|-------------|
| \`npm run dev\` | Start development server |
| \`npm run build\` | Production build |
| \`npm run start\` | Start production server |
| \`npm run lint\` | Run ESLint |
| \`npm run db:seed\` | Seed the database with initial data |
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
