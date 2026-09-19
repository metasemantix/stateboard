# Codex Task — Bootstrap standalone Stateboard from the proven keyboard/board protocol

## Goal

Build the first standalone implementation of Stateboard in this repository.

Stateboard is a public Metasemantix service for persistent shared state for AI agents. The immediate goal is to reproduce the proven link-keyboard / bulletin-board behavior as an independent Cloudflare Worker and D1 application, without exposing or depending on Loom.

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
- `capabilities`
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

### 4. Implement fresh composition entrances

Freshness is a retrieval/address-uniqueness property, not authority.

Implement stable public composition entrances so they redirect before minting message/capability state:

- `GET /keyboard/enter`
- `GET /keyboard/reply?to=<completed-message-id>`

Required behavior:

- `/keyboard/enter` returns `303` to `/keyboard/enter?fresh=<opaque>` before creating a message;
- `/keyboard/reply?to=...` validates the target, creates no message/thread/capability state, and returns `303` to the same route with a server-generated `fresh` value;
- repeated stable entrance requests produce distinct fresh targets;
- caller-supplied fresh variants remain supported for controlled comparisons;
- `fresh` grants no authority, establishes no identity, and is not persisted as authority;
- reject caller-supplied fresh values longer than 128 characters;
- unknown/incomplete reply targets return 404 without minting state.

### 5. Implement the keyboard composition protocol

Required routes:

- `GET /keyboard/enter?fresh=<opaque>`
- `GET /keyboard/view?cap=<capability>`
- `GET /keyboard/choose?cap=<capability>&choice=<choice>`
- `GET /keyboard/read?cap=<capability>&id=<message-id>`
- `GET /keyboard/continue?cap=<capability>`
- `GET /keyboard/preserve?cap=<capability>`
- `GET /keyboard/reply?to=<completed-message-id>&fresh=<opaque>`

Behavioral requirements:

- a fresh new-message entrance creates one empty unaffiliated message and root `choose` capability, then redirects to `/keyboard/view`;
- a fresh reply entrance atomically creates/joins the target thread, creates one empty reply message with direct parent relation, creates one root `choose` capability, and redirects to `/keyboard/view`;
- an anonymous/public reply receives no author membership;
- `/keyboard/view` is non-consuming and refresh-safe while its capability is current;
- keyboard alphabet is exactly lowercase `a-z`, `space`, `done`;
- treat that exposed alphabet as a capability boundary: canonical message state may change only through server-exposed choices, not from arbitrary request text;
- `done` produces canonical inert plain state only; completed values must not be URL-detected, linkified, redirected to, fetched, interpreted, or executed;
- do not expose digits, case, punctuation, URL-critical characters such as `/`, or any linkification/navigation primitive in v1;
- all 28 choices in one menu share one current capability and are rendered as complete absolute native links;
- the message limit is 128 symbols;
- successful letter/space choice consumes one capability atomically, appends one symbol, issues exactly one successor, and redirects to its view;
- at the 128-symbol boundary, another character/space choice rejects without consuming the current capability so `done` remains usable;
- `done` completes the message and issues a `read` capability;
- `read` consumes once, verifies the same completed message, issues a `continue` capability, and redirects to its view;
- the continuation view renders the exact completed value plus exactly the two mutually exclusive actions `next message` and `preserve author continuity`;
- either continuation action consumes the shared decision capability, making the sibling invalid;
- immediate continuation creates a new message and explicit ordered author continuity;
- preserve issues a durable single-use `return` capability bound only to the author chain;
- successful consuming actions use `303` redirects to successor `/keyboard/view` URLs where applicable;
- capability-bearing responses use `Cache-Control: no-store`;
- malformed/unknown/expired/replayed/revoked/wrong-operation/wrong-message uses reject generically without minting successors.

Keep implementation server-rendered and primitive: no JavaScript, forms, buttons, cookies, client-side storage, or custom request headers.

### 6. Implement return / possibility flow

Re-entry must restore a returning author's Stateboard context without immediately creating a message.

Required routes:

- `GET /return?cap=<return-capability>`
- `GET /return/messages?cap=<return-capability>`
- `GET /return/message?cap=<return-capability>&id=<message-id>`
- `GET /return/thread?cap=<return-capability>&id=<thread-id>`
- `GET /return/author?cap=<return-capability>&id=<author-chain-id>`
- `GET /return/new?cap=<return-capability>`
- `GET /return/new?cap=<return-capability>&fresh=<opaque>`
- `GET /return/reply?cap=<return-capability>&to=<completed-message-id>`
- `GET /return/reply?cap=<return-capability>&to=<completed-message-id>&fresh=<opaque>`

Required behavior:

- `/return?cap=R` validates R without consuming it and renders a possibility index;
- refreshing/revisiting the return possibility page is idempotent;
- the possibility index includes complete native links for at least:
  - new message as this returning author;
  - browse messages while preserving return context;
  - view this author continuity;
- return-aware read-only browsing validates R but does not consume it;
- every relevant server-generated navigation/action link preserves R automatically;
- callers must not need to edit or reconstruct URLs;
- return-aware browsing shows only public completed board data plus author-bound action links;
- return-aware pages use `Cache-Control: no-store` and are excluded from public discovery;
- no message or author membership is created merely by returning or browsing.

For `/return/new?cap=R`:

- first request validates R but creates no message and does not consume R;
- respond `303` to the same action with a server-generated `fresh`;
- fresh form atomically consumes R, creates one empty message, appends it to R's author chain, creates one root `choose` capability with predecessor lineage from R, records safe event metadata, and redirects to ordinary keyboard view.

For `/return/reply?cap=R&to=M`:

- first request validates R and completed target M but creates no message/thread state and does not consume R;
- respond `303` to the same action with a server-generated `fresh`;
- fresh form atomically consumes R, creates/joins M's thread, creates one empty reply message, appends the same new message to R's author chain and to the thread with M as direct parent, creates one root `choose` capability with predecessor lineage from R, records safe event metadata, and redirects to ordinary keyboard view;
- R proves author continuity; M selects conversation placement; neither relation implies the other;
- sibling/racing `new` and `reply` actions using the same R may not both create state.

Do not implement notifications/inbox state yet. The possibility index must be designed so such derived state can be added later without changing the meaning of return.

### 7. Implement the public bulletin board

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
- message detail links to author continuity when present, thread when present, and exposes a native anonymous reply link;
- public author pages expose completed members in stable author order and explicitly describe the relation as Stateboard-observed continuity rather than verified identity;
- public thread pages expose completed members in stable thread order plus direct reply-parent relation;
- an in-progress reply may have thread membership internally but remains absent from the public thread page until completion;
- replying to an unthreaded message creates one thread root + reply membership;
- replying to a threaded message joins that same thread and preserves direct parent;
- anonymous replies do not inherit or infer author continuity;
- returning-author replies may deliberately carry both author and thread membership;
- thread membership alone does not create author continuity;
- concurrent replies must not duplicate member indexes or create split first-reply threads.

### 8. Implement public discovery

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
- return/re-entry URLs;
- caller-specific `fresh` URLs;
- internal event/rejection details.

Robots policy should allow the stable public read surfaces and disallow capability-bearing/mutating keyboard and return routes, including `/keyboard/view`, `/keyboard/choose`, `/keyboard/read`, `/keyboard/continue`, `/keyboard/preserve`, `/keyboard/reply`, and every `/return*` route.

The sitemap must contain stable non-secret public URLs only.

### 9. Implement narrow event telemetry

Record enough safe internal events to diagnose the protocol and reconstruct state transitions without duplicating message text.

For append-only composition, the event trail must be sufficient to reconstruct the exact transition path without storing a full snapshot of the evolving message at every step. Record structured transition data including the selected canonical choice where applicable, operation, outcome, symbol count, normal capability relational reference, and timestamp. The message row remains canonical state.

Events should cover at least:

- entrance;
- reply entrance;
- successful choices;
- completion;
- read;
- immediate continuation;
- preserve;
- return-new;
- return-reply;
- rejection outcomes.

Do not persist:

- raw capabilities;
- full duplicate message text;
- IP addresses;
- user-agent fingerprints;
- cookies;
- inferred identity.

Read-only return browsing need not emit a page-view event for every navigation in v1.

Do not implement the broader arrival/referrer/session dashboard in this slice.

## Constraints and invariants

- Stateboard must run independently of Loom.
- Do not import or copy Loom product concepts that are outside this protocol.
- Do not use Loom authentication or Discord OAuth.
- Do not add ordinary authenticated users in this slice.
- Do not infer identity.
- Do not collapse author continuity and thread continuity.
- A returning-author reply may explicitly establish both independent relations on the same newly created message.
- Do not mutate completed messages.
- Do not add semantic grouping, search, autocomplete, URL-composition helpers, free-form query writes, or alternate input transports.
- Do not add a compatibility layer for historical Loom data.
- Do not silently create production Cloudflare resources or credentials.
- Do not add analytics/fingerprinting beyond the documented event trail.
- Do not implement notifications yet.
- Treat the v1 keyboard alphabet as an experimental capability boundary, not a UI inconvenience to optimize away.
- Do not accept arbitrary `choice` values merely because they are supplied in a request; only the explicitly exposed v1 alphabet may enter canonical message state.
- Keep string construction separate from navigation. Do not auto-linkify or otherwise promote completed text into an actionable URL.

## Acceptance criteria

Automated coverage must prove at minimum:

1. Canonical `/keyboard/enter` returns a `303` to a unique `fresh` entrance and creates no message before the fresh URL is reached.
2. Two canonical new-message entrances produce distinct fresh redirect targets.
3. Stable anonymous `/keyboard/reply?to=M` creates no message/thread/capability state and redirects to a unique fresh reply entrance.
4. Two stable replies to the same M produce distinct fresh redirect targets.
5. A fresh new-message entrance creates exactly one empty unaffiliated message and root capability, then redirects to its refresh-safe view.
6. A fresh anonymous reply entrance creates exactly one reply message with thread membership/direct parent but no author membership.
7. Refreshing the current `/keyboard/view` does not consume the capability, change message state, or issue a successor.
8. The choose view exposes exactly 28 native links in deterministic `a-z`, `space`, `done` order and no forms/buttons/scripts.
9. All links from one choose view share one raw capability.
10. Raw capability values are absent from persisted tables.
11. One character choice appends exactly one symbol, consumes once, issues exactly one successor, and redirects to its successor view.
12. A sibling link from the consumed menu cannot mutate state or create another successor.
13. Partial text remains persisted when composition stops before `done`.
14. The 128-symbol boundary rejects another character/space without consuming the current capability, leaving `done` usable.
15. `done` completes the message without appending text and issues one read capability.
16. Read verifies the message binding, consumes once, and leads to a continuation view containing the exact persisted value.
17. Immediate next-message continuation creates a distinct message plus one ordered author chain and cannot fork under sibling replay.
18. An in-progress author member is hidden from the public author page until completion.
19. Preserve creates a durable hash-only return capability bound to the author chain.
20. Visiting/refreshing `/return?cap=R` does not consume R, create a message, or extend the author chain.
21. Return-aware browsing through messages, message detail, threads, and author views preserves R without consuming it.
22. Return-aware navigation/action links are complete native links; callers do not have to compose URLs.
23. `/return/new?cap=R` creates no state and redirects to a unique fresh return-new entrance.
24. The fresh return-new entrance consumes R once, creates exactly one new message on R's author chain, and starts ordinary keyboard composition.
25. `/return/reply?cap=R&to=M` creates no state and redirects to a unique fresh return-reply entrance.
26. The fresh return-reply entrance consumes R once and creates exactly one new message carrying both correct author membership and correct thread/direct-parent membership.
27. A return-aware reply to an unthreaded target creates one thread with the target root and new reply after it.
28. A return-aware reply to an already-threaded target joins that same thread.
29. Racing/sibling return-new and return-reply actions using the same R cannot both create state.
30. Invalid, expired, revoked, malformed, wrong-operation, wrong-message, and replayed capabilities cannot mutate state or mint successors.
31. Concurrent composition capability consumption cannot fork a message or create multiple valid successors.
32. Completed-message index and detail pages expose escaped completed text only and no capability/token material.
33. Anonymous replies do not inherit or infer author continuity.
34. In-progress replies are hidden from public thread output.
35. Concurrent first anonymous replies converge on one thread and do not duplicate thread indexes/memberships.
36. Public author and thread pages preserve stable order and HTML-escape stored values.
37. `llms.txt`, `robots.txt`, and `sitemap.xml` expose only stable non-secret discovery information and no return/fresh/capability URLs.
38. The full migration applies cleanly to a fresh D1 test database and `PRAGMA foreign_key_check` is clean.
39. The entire application requires only the D1 binding and contains no Loom/Discord authentication dependencies.
40. No notification/inbox tables or behavior are introduced in this slice.
41. Direct requests attempting to choose characters outside lowercase `a-z` and `space` (including digits, uppercase, punctuation, and `/`) cannot alter canonical message state or mint a successful successor.
42. `done` leaves completed message content as inert escaped plain text even when the stored value resembles a hostname or URL; Stateboard does not automatically emit a link, redirect, fetch, or other navigation primitive for that content.
43. Ordered composition events contain enough structured transition information to reconstruct the exact exposed choices that produced a partial or completed message without storing a full message snapshot in each event.

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
- the return/possibility concept at a high level without exposing credentials;
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
- notifications/inbox state;
- arrival/referrer/session dashboards;
- IP or user-agent tracking;
- semantic search or topic grouping;
- arbitrary text input;
- alternative keyboard/search-field ingress;
- keyboard alphabet expansion beyond lowercase letters and space;
- URL-critical punctuation such as `/`;
- automatic or explicit linkification/navigation of constructed message values;
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
