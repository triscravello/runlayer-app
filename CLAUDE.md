@AGENTS.md

# RunLayer — Claude Code Instructions

## Purpose

This file defines how Claude Code should operate within the RunLayer repository.

Follow the shared engineering standards in `AGENTS.md`. The instructions below supplement those standards with Claude Code-specific workflows, approval requirements, and reporting expectations.

## Working Principles

- Inspect existing code before proposing changes.
- Prefer evidence-based reasoning over assumptions.
- Preserve established architecture unless changes are justified.
- Favor small, testable, reversible modifications.
- Clearly distinguish verified facts from assumptions.
- Do not introduce dependencies or infrastructure without approval.
- Never claim a task is complete without appropriate verification.

## Working Modes

### Audit Mode

Use Audit Mode whenever the user requests a repository review, security audit, architecture assessment, or code-quality evaluation.

In Audit Mode:

- Inspect the repository without modifying application code.
- Do not automatically fix discovered issues.
- Do not install or upgrade dependencies.
- Do not modify database schemas or records.
- Do not execute migrations or seed commands.
- Do not commit, push, or deploy.
- Request approval before executing commands that may alter files, databases, services, or external systems.
- Report findings with exact source references and supporting evidence.

Start by inspecting Git status, repository structure, project documentation, dependencies, and existing tests.

### Implementation Mode

Enter Implementation Mode only when the user explicitly approves a specific change.

Before editing:

1. Explain the issue and its impact.
2. Identify affected files.
3. Propose the implementation approach.
4. Describe required tests.
5. Identify risks and dependencies.
6. Obtain approval.

After editing:

- Summarize changed files.
- Report verification commands and results.
- Identify unresolved issues.
- Do not commit or push unless requested.

## Repository Audit Workflow

For comprehensive audits, use the following sequence.

### Phase 1 — Discovery

- Record branch, commit SHA, and working-tree status.
- Inspect repository structure and dependencies.
- Read project documentation and configuration.
- Map major application workflows.
- Identify discrepancies between documentation and implementation.

### Phase 2 — Architecture and Code Quality

Review:

- Next.js App Router organization.
- Server and client boundaries.
- TypeScript safety.
- React component design.
- API handlers and service boundaries.
- Database repositories.
- Error handling and validation.
- Maintainability and unnecessary complexity.

### Phase 3 — Security

Review authentication, authorization, sessions, administrative permissions, input validation, sensitive data handling, and user-resource ownership.

Trace critical operations from API entry points to database queries.

### Phase 4 — Recommendation Engine

Review weather normalization, filtering, scoring, ranking, explanations, versioning, and edge cases.

Verify that identical inputs and configuration produce deterministic results.

### Phase 5 — Persistence and Reliability

Review Prisma models, transactions, indexes, concurrency, Redis behavior, weather API failures, logging, and observability.

### Phase 6 — Testing and Verification

Inspect existing tests and identify coverage gaps.

Before running verification commands, determine whether they may modify the working tree or require external services.

Report exact commands, outcomes, and environmental limitations.

### Phase 7 — Findings and Roadmap

Classify findings:

- P0 — Critical
- P1 — High
- P2 — Medium
- P3 — Low

For each finding provide:

- Finding ID.
- Severity and confidence.
- File path and line number.
- Supporting evidence.
- Impact.
- Reproduction or verification steps.
- Recommended remediation.
- Suggested regression test.

Separate confirmed defects from potential risks.

## Required Audit Deliverables

A comprehensive audit should produce:

1. Executive summary and production-readiness assessment.
2. Architecture and code-quality review.
3. Security findings.
4. Recommendation-engine assessment.
5. Database and reliability assessment.
6. Test and verification report.
7. Prioritized remediation roadmap.
8. Portfolio-readiness recommendations.

Do not create report files without approval.

## Approval Gates

Pause for explicit approval before:

- Modifying application code.
- Installing or upgrading dependencies.
- Changing database schemas or records.
- Executing destructive commands.
- Performing external load tests.
- Introducing architectural changes.
- Committing, pushing, or deploying.

Read-only repository inspection does not require additional approval.

## Communication

For substantial tasks:

1. Present the plan.
2. Explain relevant evidence.
3. Identify assumptions and risks.
4. Report findings by severity.
5. Recommend next actions.
6. Wait for approval before implementation.

Avoid speculative findings, inflated severity, and unsupported production-readiness claims.

## Current Priority

The immediate objective is a comprehensive, evidence-based RunLayer repository and code-quality audit.

Remain in Audit Mode until the user explicitly approves remediation work.