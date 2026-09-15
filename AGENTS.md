# AGENTS.md

## Current task

When `CODEX_TASK.md` exists, treat it as the executable task specification for the current run. Read it completely before changing code, and read every repository document it references.

If `CODEX_TASK.md` conflicts with durable architecture documentation under `docs/`, stop and resolve the conflict explicitly rather than silently choosing one.

## Repository purpose

Stateboard is a small public Metasemantix service for persistent shared state for AI agents. It is intentionally independent of Loom at runtime.

Do not introduce Loom participants, projects, documents, authentication, compression, invitations, or other Loom product concepts unless a future repository task explicitly asks for them.

## Preserve protocol boundaries

Keep message state, capability authority, author continuity, and thread continuity distinct. Do not infer author identity or thread membership from ambient signals such as IP address, user agent, cookies, timing, or prose similarity.

Raw capability tokens are secrets. Persist only hashes. Never log or expose token hashes, raw capabilities, re-entry material, or internal rejection telemetry on public read-only pages.

The link keyboard deliberately uses GET-shaped mutation as an isolated experiment. Do not generalize that transport pattern into unrelated APIs.

## Dependency and tooling hygiene

Prefer the repository's existing dependencies and locked toolchain. Do not add packages for optional convenience.

At the start of a run that will use Node/npm tooling, inspect the installed Node and npm versions and check whether npm itself has a newer compatible stable release available. When the environment permits a tooling-only npm update without changing repository files, prefer updating npm before substantial install/test work rather than carrying a known-stale package-manager version through the run. Do not update Node, repository dependencies, `package.json`, or lockfiles merely because newer versions exist.

Treat package-manager updates as execution-environment maintenance, not product changes. After an npm tooling update, verify that repository files were not modified solely by that update.

If `package-lock.json` exists and dependencies need provisioning, prefer `npm ci`. A missing test binary such as `vitest: not found` is a setup failure, not a test result.

If npm crashes internally, including errors such as `Cannot read properties of null (reading 'edgesOut')`, update npm to the current compatible stable release when possible and retry the failed setup command once.

If an install or tooling update is blocked by a clear network/proxy/sandbox restriction, do not repeatedly retry. Do not alter Stateboard dependencies or package configuration merely to work around the environment. Continue with available checks where possible and report the exact blocked validation.

## Before declaring completion

Run all checks required by `CODEX_TASK.md`. Required test commands must actually execute their test runner; do not count a missing binary or dependency-install failure as a test pass.

Report:

- implementation summary;
- migrations/schema changes;
- tests/checks run and exact results;
- any validation that could not run and why;
- any intentionally deferred work.
