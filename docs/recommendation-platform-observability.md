# Recommendation Platform Observability

## Architecture Decisions

- Analytics are computed on demand from existing recommendation history, recommendation feedback, saved kits, user profiles, and weather snapshots.
- The implementation does not store analytics snapshots. This keeps metrics deterministic and avoids duplicating business logic outside of the recommendation engine.
- Platform analytics use aggregate database queries and SQL grouping over recommendation, feedback, saved outfit, outfit item, gear item, brand, and weather snapshot tables.
- User insights are deterministic. They are derived from actual saved kits, recommendation history, profile preferences, feedback counts, gear tags, and weather context.
- Recommendation scores are not recalculated for analytics or insights. The analytics layer only observes persisted engine outputs and related metadata.
- Compared-brand and viewed-brand analytics are represented as empty datasets because the current schema does not persist compare or view events. This avoids inventing analytics from unrelated data.

## Recommendation Engine Versioning

- `config/recommendationEngineVersion.ts` is the single source of truth for the current engine version. 
- New recommendation history records store both `engineVersion` and `generatedAt` on the recommendation row for efficient filtering.
- New recommendation history records also create a `RecommendationVersionMetadata` row with `recommendationId`, `engineVersion`, and `timestamp` so future engine audits can compare versions without schema redesign.
- `lib/engine/versioning/versionMetadata.ts` stores human-readable release metadata for audit and debugging surfaces.