# RunLayer — Shared Engineering Instructions

This file defines repository-wide instructions for AI coding agents working on RunLayer.

## Project Context

RunLayer is a full-stack application that recommends running apparel based on real-time weather, workout conditions, and individual runner preferences.

Primary technologies:
- Next.js 16, React 19, TypeScript
- Tailwind CSS 4 and Radix UI
- PostgreSQL and Prisma 5
- Zod, Zustand
- Redis / Upstash
- Prometheus, Grafana, Winston

Use `package.json`, the lockfile, and source code to verify actual dependencies and behavior.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Architecture

Respect existing architectural boundaries:

- `app/` — Routing, pages, API handlers.
- `components/` — UI components.
- `lib/engine/` — Recommendation logic.
- `lib/db/` — Database repositories.
- `lib/auth/` — Authentication.
- `lib/weather/` — Weather integrations.
- `lib/validation/` — Input validation.
- `services/` — Business services.
- `prisma/` — Schema and migrations.
- `store/` — Client-side state.
- `config/` — Application configuration.

Verify actual responsibilities before restructuring modules.

Keep business logic separate from transport, presentation, and persistence concerns.

## Engineering Standards

- Prefer strict TypeScript and explicit interfaces.
- Avoid unnecessary abstractions and duplicated logic.
- Validate untrusted inputs using Zod where appropriate.
- Keep secrets and server-only dependencies out of client bundles.
- Handle errors explicitly.
- Preserve accessible and responsive UI behavior.
- Avoid introducing dependencies without justification.
- Prefer focused, testable changes.

## Security

- Enforce authentication server-side.
- Authorize every user-owned resource operation.
- Enforce administrative permissions at API boundaries.
- Prevent BOLA/IDOR vulnerabilities.
- Never trust client-provided identity or roles.
- Protect passwords, sessions, and credentials.
- Avoid leaking sensitive data through logs or responses.
- Review injection, CSRF, XSS, and SSRF risks.

Security controls must be verified in the implementation, not assumed from documentation.

## Database

PostgreSQL is the authoritative data store.

- Maintain referential integrity.
- Use transactions for atomic operations.
- Consider concurrency and race conditions.
- Prevent N+1 queries.
- Preserve data ownership boundaries.
- Review indexes for frequently accessed records.
- Do not run destructive migrations without approval.

Redis must not become the authoritative store for persistent user data.

## Recommendation Engine

The recommendation engine is the application's central business capability.

Maintain:

- Deterministic scoring.
- Consistent weather normalization.
- Explicit filtering and ranking.
- Stable tie-breaking.
- Transparent explanations.
- Preference and budget constraints.
- Recommendation version metadata.
- Edge-case and regression coverage.

Do not introduce machine learning or fundamentally change ranking behavior without approval.

## Reliability and Observability

- Handle external service failures explicitly.
- Use bounded timeouts and appropriate retries.
- Ensure graceful degradation where designed.
- Avoid logging sensitive information.
- Preserve useful operational metrics.
- Measure performance before optimizing.

## Verification

Available project commands:

- `npm test`
- `npm run lint`
- `npm run build`
- `npx tsc --noEmit`

Confirm local dependencies and environmental requirements before running checks.

For code changes, run relevant tests and report results accurately.

Do not claim checks passed unless they were executed successfully.

## Review Standards

For repository audits:

1. Inspect the current Git state.
2. Read the relevant source files.
3. Trace critical workflows end-to-end.
4. Cite file paths and line numbers.
5. Distinguish confirmed defects from potential risks.
6. Prioritize findings by impact and severity.
7. Recommend reproducible verification steps.
8. Identify appropriate regression tests.
9. Preserve positive engineering decisions.

Never fabricate findings or test results.

## Change Safety

- Preserve existing uncommitted work.
- Do not modify unrelated files.
- Do not install dependencies without approval.
- Do not execute destructive database operations.
- Do not commit, push, or deploy without authorization.
- Obtain approval before implementing substantial architectural changes.

For audit-only tasks, do not modify application code.

## Definition of Done

An approved implementation task is complete when:

1. The requested behavior is implemented.
2. Relevant regression tests are added or updated.
3. Appropriate verification commands have been run.
4. Security and data ownership remain intact.
5. Changes are documented where necessary.
6. Remaining limitations are clearly reported.

Report environmental blockers rather than presenting incomplete verification as success.
