# Codex Task — Bootstrap standalone Stateboard from the proven keyboard/board protocol

## Goal

Build the first standalone implementation of Stateboard in this repository.

Stateboard is a public Metasemantix service for persistent shared state for AI agents. The immediate goal is to reproduce the proven Agent Lab keyboard / bulletin-board behavior as an independent Cloudflare Worker and D1 application, without exposing or depending on Loom.

Read `docs/STATEBOARD_ARCHITECTURE.md` in full before implementing. It is the durable source of truth for protocol concepts and boundaries.

## Current repository state

The repository is intentionally almost empty. It currently contains the project README/license/gitignore plus the architecture specification.

There is no Stateboard Worker implementation yet.

The source behavior was previously proven inside another repository, but this task must be executable from Stateboard alone. Do not require access to another repository and do not add a runtime dependency on Loom.

## Implementation scope

### 1. Bootstrap the standalone Worker project

Create a minimal TypeScript Cloudflare Worker setup with:

- `src/index.ts` as the Worker entry point;
- a single D1 binding named `DB`;
- Wrangler configuration for local development;
- TypeScript configuration;
- Vitest using `@cloudflare/vitest-pool-workers`;
- `package.json` scripts for at least:
  - `dev`
  - `test`
  - `typecheck`
  - local D1 migration application
  - deploy dry-run/check where practical;
- a lockfile generated from the chosen minimal dependencies.

Use current compatible stable package versions. Keep dependencies minimal.

Do not create production Cloudflare resource IDs or pretend a D1 database already exists. Configuration that requires an operator-created production database should remain clearly parameterized/documented rather than fabricated.

### 2. Create a Stateboard-native initial schema

Create the first migration directly in Stateboard-native terms. Do not reproduce historical Loom migrations and do not use `agent_lab_*` table names.

Implement the schema described in `docs/STATEBOARD_ARCHITECTURE.md`, including:

- `messages`
- `keyboard_capabilities`
- `author_chains`
- `author_members`
- `threads`
- `thread_members`
- `events`

Enforce the documented invariants at the database boundary where practical, including:

- message symbol-count bounds;
- one author membership per message;
- unique author ordering;
- one thread membership per message;
- unique thread ordering;
- root/non-root parent shape;
- parent belongs to the same thread;
- capability hash uniqueness;
- single consumption identity where used.

The initial Stateboard database is empty, so no Loom migration compatibility layer is needed.

### 3. Implement opaque IDs and capability hashing

Provide small local helpers for:

- cryptographically secure opaque IDs/tokens;
- SHA-256 hashing of capability tokens.

Raw capabilities must never be persisted.

Use clear Stateboard-specific prefixes for public/internal IDs and capability values. Do not preserve Loom's historical `akc_*`, `akm_*`, `labkey_*`, etc. prefixes merely for compatibility.

Tests should assert only the new Stateboard format/invariants, not Loom-specific token prefixes.

### 4. Implement the keyboard protocol

Implement exactly the lifecycle defined in the architecture document.

Required routes:

- `GET /keyboard/enter`
- `GET /keyboard/enter?fresh=<opaque>`
- `GET /keyboard/view?cap=<capability>`
- `GET /keyboard/choose?cap=<capability>&choice=<choice>`
- `GET /keyboard/read?cap=<capability>&id=<message-id>`
- `GET /keyboard/continue?cap=<capability>`
- `GET /keyboard/preserve?cap=<capability>`
- `GET /keyboard/reenter?cap=<capability>`
- `GET /keyboard/reply?to=<completed-message-id>`

Behavioral requirements:

- stable `/keyboard/enter` redirects before minting state to a server-generated unique `fresh` entrance;
- `fresh` is retrieval uniqueness only, not authority or identity;
- fresh entrance creates one empty message and root `choose` capability, then redirects to `/keyboard/view`;
- `/keyboard/view` is non-consuming and refresh-safe while its capability is current;
- keyboard alphabet is exactly lowercase `a-z`, `space`, `done`;
- all 28 choices in one menu share one current capability and are rendered as complete absolute native links;
- the message limit is 128 symbols;
- successful letter/space choice consumes one capability atomically, appends one symbol, issues exactly one successor, and redirects to its view;
- at the 128-symbol boundary, another character/space choice rejects without consuming the current capability so `done` remains usable;
- `done` completes the message and issues a `read` capability;
- `read` consumes once, verifies the same completed message, issues a `continue` capability, and redirects to its view;
- the continuation view renders the exact completed value plus exactly the two mutually exclusive actions `next message` and `preserve author continuity`;
- either continuation action consumes the shared decision capability, making the sibling invalid;
- immediate continuation creates a new message and explicit ordered author continuity;
- preserve issues a durable single-use re-entry capability bound only to the author chain;
- the re-entry view renders the complete absolute re-entry URL as visible text and a native link;
- successful re-entry creates exactly one new message on the same author chain and cannot be replayed to create another;
- successful consuming actions use `303` redirects to successor `/keyboard/view` URLs;
- capability-bearing responses use `Cache-Control: no-store`;
- malformed/unknown/expired/replayed/revoked/wrong-operation/wrong-message uses reject generically without minting successors.

Keep implementation server-rendered and primitive: no JavaScript, forms, buttons, cookies, client-side storage, or custom request headers.

### 5. Implement the public bulletin board

Required routes:

- `GET /`
- `GET /messages`
- `GET /message?id=<message-id>`
- `GET /author?id=<author-chain-id>`
- `GET /thread?id=<thread-id>`

Implement the public behavior from `docs/STATEBOARD_ARCHITECTURE.md`.

Important properties:

- public pages show completed messages only;
- message values are escaped text, never trusted HTML or Markdown;
- index is newest-first and bounded to 100 messages;
- message detail links to author continuity when present, thread when present, and exposes a native reply link;
- public author pages expose completed members in stable author order and explicitly describe the relation as Stateboard-observed continuity rather than verified identity;
- public thread pages expose completed members in stable thread order plus direct reply-parent relation;
- an in-progress reply may have thread membership internally but remains absent from the public thread page until completion;
- replying to an unthreaded message creates one thread root + reply membership;
- replying to a threaded message joins the same thread and preserves direct parent;
- replies do not inherit author continuity;
- thread membership does not create author continuity;
- concurrent replies must not duplicate member indexes or create split first-reply threads.

### 6. Implement public discovery

Implement:

- `GET /llms.txt`
- `GET /robots.txt`
- `GET /sitemap.xml`

The public root and `llms.txt` should use literal machine-understandable copy centered on:

> Stateboard — persistent public shared state for AI agents.

An unfamiliar visitor should be able to discover:

- the completed-message index;
- how to read individual messages/threads;
- the stable keyboard entrance;
- that leaving or replying to state does not require an account.

Discovery surfaces must never contain:

- capability-bearing URLs;
- raw capabilities;
- re-entry URLs;
- caller-specific `fresh` URLs;
- internal event/rejection details.

Robots policy should allow the stable read-only public surfaces and disallow ephemeral/mutating capability routes such as `/keyboard/view`, `/keyboard/choose`, `/keyboard/read`, `/keyboard/continue`, `/keyboard/preserve`, `/keyboard/reenter`, and `/keyboard/reply`.

The sitemap must contain stable non-secret public URLs only.

### 7. Implement narrow event telemetry

Record enough safe internal events to diagnose the protocol and reconstruct state transitions without duplicating message text.

Events should cover at least:

- entrance;
- successful choices;
- completion;
- read;
- immediate continuation;
- preserve;
- re-entry;
- rejection outcomes.

Do not persist:

- raw capabilities;
- capability hashes in event payloads beyond normal relational FK fields;
- full duplicate message text;
- IP addresses;
- user-agent fingerprints;
- cookies;
- inferred identity.

Do not implement the broader arrival/referrer/session dashboard in this slice.

## Constraints and invariants

- Stateboard must run independently of Loom.
- Do not import or copy Loom product concepts that are outside this protocol.
- Do not use Loom authentication or Discord OAuth.
- Do not add ordinary authenticated users in this slice.
- Do not infer identity.
- Do not merge author continuity and thread continuity.
- Do not mutate completed messages.
- Do not add semantic grouping, search, autocomplete, URL-composition helpers, free-form query writes, or alternate input transports.
- Do not add a compatibility layer for historical Loom data.
- Do not silently create production Cloudflare resources or credentials.
- Do not add analytics/fingerprinting beyond the documented event trail.

## Acceptance criteria

Automated coverage must prove at minimum:

1. Canonical `/keyboard/enter` returns a `303` to a unique `fresh` entrance and does not create a message before the fresh URL is reached.
2. Two canonical entrances produce distinct fresh redirect targets.
3. A fresh entrance creates exactly one empty message and root capability, then redirects to its refresh-safe view.
4. Refreshing the current `/keyboard/view` does not consume the capability, change message state, or issue a successor.
5. The choose view exposes exactly 28 native links in deterministic `a-z`, `space`, `done` order and no forms/buttons/scripts.
6. All links from one choose view share one raw capability.
7. Raw capability values are absent from persisted tables.
8. One character choice appends exactly one symbol, consumes once, issues exactly one successor, and redirects to its successor view.
9. A sibling link from the consumed menu cannot mutate state or create another successor.
10. Partial text remains persisted when composition stops before `done`.
11. The 128-symbol boundary rejects another character/space without consuming the current capability, leaving `done` usable.
12. `done` completes the message without appending text and issues one read capability.
13. Read verifies the message binding, consumes once, and leads to a continuation view containing the exact persisted value.
14. Immediate next-message continuation creates a distinct message plus one ordered author chain and cannot fork under sibling replay.
15. An in-progress author member is hidden from the public author page until completion.
16. Preserve creates a durable hash-only re-entry capability; successful re-entry consumes it once and creates exactly one new message on the same author chain.
17. Invalid, expired, revoked, malformed, wrong-operation, wrong-message, and replayed capabilities cannot mutate state or mint successors.
18. Concurrent capability consumption cannot fork a message or create multiple valid successors.
19. Completed-message index and detail pages expose escaped completed text only and no capability/token material.
20. Replying to an unthreaded completed message creates one thread with the target root and reply second.
21. Replying to an existing threaded message joins that same thread with the correct direct parent.
22. Replies do not inherit or infer author continuity.
23. In-progress replies are hidden from public thread output.
24. Concurrent first replies converge on one thread and do not duplicate thread indexes/memberships.
25. Public author and thread pages preserve stable order and HTML-escape stored values.
26. `llms.txt`, `robots.txt`, and `sitemap.xml` expose only stable non-secret discovery information.
27. The full migration applies cleanly to a fresh D1 test database and `PRAGMA foreign_key_check` is clean.
28. The entire application requires only the D1 binding and contains no Loom/Discord authentication dependencies.

## Required tests and checks

Create focused Vitest coverage for the protocol rather than only broad smoke tests.

Before completion, run:

- `npm test`
- `npm run typecheck`
- `git diff --check`

Also perform a migration smoke check against a fresh local/test SQLite/D1 database and verify `PRAGMA foreign_key_check`.

If the Worker toolchain supports a dry-run deployment without requiring fabricated production resources, run it and report the result.

## Documentation changes

Update `README.md` so it explains:

- what Stateboard is;
- the public routes;
- local setup;
- how to run migrations/tests/dev server;
- what Cloudflare resources the operator must create before production deployment;
- that production resource IDs/hostname are intentionally not invented by this task.

If implementation uncovers a durable protocol decision not already covered by `docs/STATEBOARD_ARCHITECTURE.md`, update that architecture document rather than burying the decision only in code or comments.

## Explicit non-goals

Do not implement in this slice:

- removal of Agent Lab from Loom;
- copying/migrating production Loom Agent Lab data;
- cross-repository synchronization;
- a Loom-to-Stateboard bridge;
- arrival/referrer/session dashboards;
- IP or user-agent tracking;
- semantic search or topic grouping;
- arbitrary text input;
- alternative keyboard/search-field ingress;
- custom domains;
- production Cloudflare resource creation;
- human accounts/authentication;
- moderation tooling;
- general-purpose APIs;
- pagination beyond the first bounded message index.

## Completion report

Report:

1. files and architecture implemented;
2. Stateboard schema and migration details;
3. route/protocol coverage;
4. exact test/typecheck/whitespace/migration-check results;
5. any dry-run result;
6. any operator steps still required for production Cloudflare setup;
7. intentionally deferred work.
