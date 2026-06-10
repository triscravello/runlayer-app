# RunLayer

Weather-driven running outfit recommendations based on real-time conditions and personal preferences.

## Overview

RunLayer helps runners make smart gear decisions by combining:
- **Real-time weather data** for your location
- **Personal profile factors** (body type, heat sensitivity, chafe preferences, style)
- **Curated gear database** with weather suitability tags
- **Smart recommendation engine** that matches conditions to optimal outfits

## Problem

Runners often rely on generic weather advice or guesswork when choosing what to wear. Temperature alone does not account for factors such as humidity, wind, workout intensity, terrain, or individual preferences.

RunLayer solves this problem by combining real-time weather data, personal runner profiles, and a rule-based recommendation engine to generate personalized running outfit recommendations.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | [Next.js 16](https://nextjs.org) (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 |
| UI Components | Radix UI + `class-variance-authority` + `tailwind-merge`
| Database | Supabase (PostgreSQL) + Prisma ORM 5 |
| Auth | [Better Auth](https://better-auth.com) |
| Validation | Zod
| State | Zustand |
| Fonts | Geist (Vercel) |

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

## Project Structure

\`\`\`
├── app/ # Next.js App Router │ ├── api/ # API routes │ │ ├── auth/[...all] # Better Auth catch-all handler │ │ ├── gear/ # Gear catalog CRUD │ │ ├── outfit/save/ # Saved outfits │ │ ├── profile/ # User profile │ │ ├── recommendation/# Recommendation engine │ │ └── weather/ # Weather API proxy │ ├── auth/ # Authentication pages (sign-in, sign-up) │ ├── dashboard/ # User dashboard │ ├── recommendation/ # Recommendation UI │ ├── layout.tsx # Root layout │ └── page.tsx # Landing page ├── components/ # React components │ ├── layout/ # Layout components │ ├── profile/ # Profile forms │ ├── recommendation/ # Recommendation displays │ ├── saved/ # Saved outfits UI │ └── ui/ # Generic UI primitives (shadcn/ui pattern) ├── config/ # App configuration (env, weather rules, brand configs) ├── content/ # Static content & prompts ├── context/ # React Context providers (Auth, App) ├── docs/ # Documentation ├── hooks/ # Custom React hooks (useAuth, useGear, useWeather, etc.) ├── lib/ # Core library code │ ├── db/ # Database repositories & Prisma client │ ├── engine/ # Recommendation algorithms │ ├── types/ # TypeScript interfaces │ └── utils/ # Helpers & validators ├── prisma/ # Prisma schema, migrations & seed data ├── scripts/ # Utility & deployment scripts ├── services/ # Business logic layer (auth, gear, weather, outfits) └── store/ # State management (React Context / custom hooks)
\`\`\`

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

## Environment Setup

Required environment variables (see [`config/env.ts`](./config/env.ts)):

\`\`\`
DATABASE_URL=           # Supabase connection string
SUPABASE_URL=           # Supabase project URL
SUPABASE_ANON_KEY=      # Supabase anon key
WEATHER_API_KEY=        # Weather API key
\`\`\`

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
| Method | Route | Description | Body |
|--------|-------|-------------|------|
| `POST` | `/api/auth/signup` | Register a new user | `{ email, password }` |
| `POST` | `/api/auth/login` | Log in an existing user | `{ email, password }` |
| `POST` | `/api/auth/logout` | Log out current user | — |

### Weather
| Method | Route | Description | Query/Body |
|--------|-------|-------------|------------|
| `GET` | `/api/weather` | Fetch current weather for a location | `?location={city}` |

### Recommendations
| Method | Route | Description | Body |
|--------|-------|-------------|------|
| `GET` | `/api/recommendation` | List all recommendations with user & weather data | — |
| `POST` | `/api/recommendation` | Create a new recommendation | `{ userId, inputContext, output, weatherSnapshotId? }` |

### Gear Catalog
| Method | Route | Description | Body |
|--------|-------|-------------|------|
| `GET` | `/api/gear` | List all gear items | — |
| `POST` | `/api/gear` | Add a new gear item | `{ name, brand, category, subcategory, genderTarget, priceRange, tags, weatherSuitability, bodyTypeFit, imageUrl?, affiliateUrl? }` |
| `PUT` | `/api/gear` | Full update of gear item | `{ id, name, brand, ... }` |
| `PATCH` | `/api/gear` | Partial update of gear item | `{ id, name?, brand?, ... }` |
| `DELETE` | `/api/gear` | Remove a gear item | `{ id }` |

### Saved Outfits
| Method | Route | Description | Query/Body |
|--------|-------|-------------|------------|
| `GET` | `/api/outfit/save` | Get saved outfits for a user | `?userId={id}` |
| `POST` | `/api/outfit/save` | Save an outfit | `{ userId, recommendationId?, name?, isFavorite? }` |

### User Profile
| Method | Route | Description | Query/Body |
|--------|-------|-------------|------------|
| `GET` | `/api/profile` | Get user profile | `?userId={id}` |
| `PUT` | `/api/profile` | Update or create user profile | `{ userId, heightCm?, weightLbs?, bodyType?, heatSensitivity?, chafeProne?, stylePreference?, budgetLevel?, preferredFit? }` |

## Development Notes

- This project uses **Next.js 16** with breaking changes from previous versions. See [AGENTS.md](./AGENTS.md).
- Weather rules and brand configs are defined in [\`config/\`](./config/)
- Recommendation logic lives in [\`lib/engine/\`](./lib/engine/)
- Custom hooks in [\`hooks/\`](./hooks/) handle data fetching with caching

## Scripts

| Command | Description |
|---------|-------------|
| \`npm run dev\` | Start development server |
| \`npm run build\` | Production build |
| \`npm run start\` | Start production server |
| \`npm run lint\` | Run ESLint |
| \`npm run db:seed\` | Seed the database with initial data |
| \`npm run postinstall\` | Automatically generates Prisma client after install |


Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
