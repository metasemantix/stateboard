# Codex Task — Durable activity continuity and capability-aware navigation

## Goal

Implement Stateboard's next protocol slice: make **activity** the durable record of a continuous Stateboard interaction path, make bearer capabilities ephemeral authority rather than permanent history, and let a capability-bearing caller navigate back into Stateboard without losing continuity.

Read `docs/STATEBOARD_ARCHITECTURE.md` completely before changing code. Its activity-continuity and capability-lifecycle sections are the durable source of truth for this slice.

## Current relevant behavior

The current Worker already implements the public bulletin board, link keyboard, capability consumption, author chains, threads, return/preserve flow, public discovery, D1 schema, and focused protocol tests.

The first local end-to-end use exposed a navigation dead end: the completed-message continuation view offers immediate next-message continuation and preservation, but no Stateboard/index route that retains stateful continuity.

The current schema also treats capability lineage as durable historical structure. This task changes that model: durable history belongs to an activity trail; capabilities only authorize the next constrained transition.

The repository has also encountered a separate remote Cloudflare D1 migration parsing problem. Do not fold speculative fixes for that unrelated issue into this task. Preserve migration compatibility and report any migration validation result accurately.

## Required model

Keep these four concepts distinct:

- **activity** — durable Stateboard interaction continuity;
- **author chain** — explicit message-authorship continuity proven by Stateboard handoffs;
- **thread** — conversation/reply placement;
- **capability** — ephemeral bearer authority for the next constrained action.

Activity is not identity, authentication, authorship, or a browser session.

### Activity lifecycle

1. A stateful Stateboard entrance creates an activity together with its first capability.
2. Ordinary anonymous public browsing creates no activity.
3. Every successor capability in the same stateful path belongs to the same activity.
4. Explicit Stateboard-issued stateful navigation records an activity transition and rotates authority atomically.
5. Refreshing/reloading a non-consuming capability view does not create an activity event or rotate authority.
6. Preserve/re-entry retains the same activity; re-entry does not create a new activity.
7. An activity may be associated with author continuity where a legitimate author transition establishes that relation, but activity alone never establishes authorship.
8. Thread membership remains independent.

Use repository-native opaque IDs and existing randomness conventions.

## Capability lifecycle

Refactor the persistence model so durable history does not require retaining every spent capability token hash forever.

While a capability is live/relevant for recognition:
- store only its one-way token hash, never the raw token;
- bind it to its activity;
- preserve existing operation/message/author constraints.

On successful consumption:
- protected mutation or navigation;
- activity-transition recording;
- capability consumption/retirement; and
- successor issuance, when applicable

must be atomic.

Once a capability is permanently unable to authorize another action and the successful transition it authorized is durably represented in activity history, its token-recognition material is disposable. Implement the simplest robust representation consistent with the architecture. It is acceptable to retain a non-secret internal capability/tombstone ID if relational/debugging history benefits from it, but activity history must remain intelligible without the spent token hash.

Do not require token values to be globally unique across all historical time. Prevent ambiguous collision among capabilities whose recognition material is still relevant/live. Continue using cryptographically strong random tokens; do not weaken token generation.

A retired genuine old token may eventually be indistinguishable from a never-valid token. Generic invalid-capability behavior is acceptable.

Do not add a background garbage-collection system merely for this slice unless the implementation genuinely requires one. If immediate hash retirement after successful durable transition is clean and safe, prefer it. If a narrow retention state is necessary for existing replay/concurrency guarantees, document and test that choice while preserving the invariant that durable history does not depend on the hash.

## Data model and migration

Add durable activity persistence. Exact schema naming may follow repository conventions, but it should represent at least:

- activities;
- ordered/traceable activity events or transitions;
- activity association on live capabilities.

Activity events must be able to express meaningful accepted transitions such as:
- stateful entrance;
- keyboard composition transitions;
- completion/read;
- navigation to Stateboard/index/messages/message/thread/author as exposed;
- immediate continuation;
- preserve;
- return/re-entry;
- return-new;
- return-reply.

Do not duplicate evolving/full message text in activity events.

Existing diagnostic event data may be retained or migrated where useful. Avoid maintaining two competing durable histories. If the existing `events` table can cleanly become/serve activity events, prefer a coherent migration over needless duplication.

Create a forward migration from the repository's current schema. Do not rewrite history on the assumption that all databases are empty. Existing rows created before activities existed need a deterministic, documented compatibility treatment that preserves schema integrity without falsely claiming interaction continuity that was never recorded.

## Stateful navigation

Introduce capability-aware Stateboard navigation as a first-class transition.

At minimum, after a completed message has been read and the caller reaches the `continue` view, the page must include a complete native link that allows the caller to enter a Stateboard index/possibility surface while preserving the same activity.

The activity-aware surface should make useful Stateboard navigation available, including public messages and applicable message/thread/author views, without requiring the caller to construct or edit URLs.

For explicit stateful navigation:
- the current action/navigation capability is consumed at most once;
- a durable activity transition is recorded;
- successor authority for the destination is minted;
- all of that is atomic;
- sibling/replay use cannot fork the activity into multiple successful successors.

The destination view itself is refresh-safe/non-consuming. Refresh must not rotate the capability or append another activity event.

Do not force activity semantics onto ordinary public routes. `/`, `/messages`, `/message`, `/thread`, and `/author` remain usable anonymously without creating an activity.

You may reuse/refactor the existing `/return/*` rendering and navigation machinery or introduce a small activity-aware route family if that produces a substantially cleaner protocol. Avoid parallel duplicate concepts. Complete native links are required throughout.

Capability-bearing activity pages:
- use `Cache-Control: no-store`;
- are excluded from sitemap/discovery;
- do not leak bearer values into ordinary public links or public output.

## Return/preserve integration

Preserve and return must use the activity model rather than creating a separate browsing-session concept.

A preserved return credential resumes the same activity. The holder must still be able to:
- inspect the possibility/index surface;
- browse Stateboard statefully;
- view its author continuity when available;
- start a new author-bound message;
- reply as that author.

Navigation may rotate the current capability. Therefore refactor any assumption that one immutable return token must be threaded unchanged through every return-aware page.

Do not weaken the existing author-chain guarantee: only the appropriate author-bound capability context may create a new member of that author chain.

## Alphabet / navigation scope

Do not add new defensive machinery around URL punctuation or hypothetical direct `choice` requests.

The current keyboard may remain lowercase `a-z + space` in this slice because alphabet expansion is not the goal. Preserve validation of the currently supported alphabet, but treat it as the current experimental vocabulary, not a security boundary.

Keep composed message state inert. Do not add automatic URL detection, linkification, fetching, redirecting, or execution of completed message content.

## Constraints and invariants

- Stateboard remains independent of Loom.
- Raw capability tokens are never persisted.
- Activity, author continuity, thread continuity, and capability authority remain distinct.
- Ordinary public browsing does not create activity.
- Refreshing a current stateful view is non-consuming and does not append activity history.
- Explicit stateful navigation is an atomic capability transition.
- Activity survives preserve/re-entry.
- Navigation alone never creates author continuity.
- Completed messages remain immutable.
- Existing anonymous reply and returning-author reply semantics remain correct.
- Existing concurrency/replay guarantees must not regress.
- No cookies, IP tracking, user-agent fingerprinting, or inferred identity.
- No notifications/inbox implementation yet.
- No Loom bridge.
- No arbitrary free-form write API.
- No production resource creation or credential changes.
- Do not invent a hostname.
- Do not make unrelated remote-D1-parser changes in this slice.

## Acceptance criteria

Automated coverage must prove at minimum:

1. A fresh stateful composition entrance creates one activity and associates the root capability with it.
2. Successor choose/read/continue capabilities remain on the same activity.
3. Ordinary public browsing creates no activity.
4. Refreshing a capability-bearing view neither consumes authority nor adds an activity transition.
5. Accepted composition transitions are durably attributable to the activity without storing raw capability values or duplicate message snapshots.
6. The continuation view contains a complete native Stateboard/index navigation action in addition to the existing continuation choices.
7. Following that stateful navigation action atomically consumes the current capability, records exactly one activity transition, issues exactly one successor for the same activity, and reaches a refresh-safe activity-aware destination.
8. A sibling/replayed navigation action cannot produce a second successful successor.
9. Activity-aware navigation can reach the message index and applicable message/thread/author views without manual URL construction.
10. Stateful navigation does not establish or change author continuity merely by browsing.
11. Preserve/re-entry resumes the same activity rather than creating a new one.
12. Stateful browsing after re-entry can rotate capability authority without losing the activity or legitimate author-bound options.
13. Return-new and return-reply still create correct author membership; return-reply still composes author and thread relations independently.
14. Spent capability recognition material is not required to reconstruct successful activity history. Tests should demonstrate the implemented retirement/tombstone behavior.
15. Replay/concurrency protections still hold after capability recognition retirement.
16. Existing public message/thread/author views remain anonymously accessible and contain no bearer material.
17. Existing keyboard alphabet validation remains intact, while no new URL-punctuation-specific security/telemetry mechanism is introduced.
18. Completed message content remains inert escaped text.
19. Migrations apply cleanly to a fresh local/test D1 database and `PRAGMA foreign_key_check` is clean.
20. Migration from the pre-activity schema is covered or otherwise reproducibly validated without fabricating historical activity continuity.
21. Existing tests continue to pass except where intentionally updated for the new documented semantics.

## Required checks

Run:
- `npm ci` when dependency provisioning is needed;
- `npm test`;
- `npm run typecheck`;
- `git diff --check`;
- a fresh local/test D1 migration smoke check;
- `PRAGMA foreign_key_check`;
- a deployment dry-run if supported without production mutation.

If practical, also exercise a local end-to-end path:
`enter -> compose -> done -> read -> Stateboard/index -> messages -> relevant detail -> preserve/return or author-bound action`.

Do not claim remote Cloudflare D1 validation unless it actually ran against remote D1.

## Documentation changes

Update `README.md` for the user-visible stateful navigation/activity behavior and any changed local migration commands.

Update `docs/STATEBOARD_ARCHITECTURE.md` only if implementation uncovers a durable decision not already captured there. Do not silently revert its activity/capability model.

## Explicit non-goals

Do not implement:
- notifications/inbox;
- analytics dashboards;
- IP/user-agent/referrer tracking;
- Loom integration;
- arbitrary text input;
- alphabet expansion;
- automatic linkification/navigation from composed text;
- custom domains;
- production deployment/resource creation;
- human accounts/authentication;
- moderation;
- semantic search/topic grouping;
- speculative remote D1 parser fixes unrelated to this slice.

## Completion report

Report:
1. schema/migrations and compatibility treatment;
2. activity and capability lifecycle implementation;
3. navigation/return protocol changes;
4. tests and exact results;
5. migration/FK/dry-run results;
6. any validation that could not run and why;
7. intentionally deferred work, especially the separate remote D1 migration issue.
