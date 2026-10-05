# MergeMind: Decision Log (ADRs)

> Every non-trivial technical choice is recorded here: **what** was chosen, **why**, **how** it was decided, and **why the alternatives were not chosen**. AI agents must append an ADR whenever they make such a choice while building.

## How to add a decision

Copy this template to the end of the file. Use the next number. Never edit an accepted ADR's decision; supersede it with a new ADR and set the old one's status to `Superseded by ADR-NNN`.

```markdown
## ADR-NNN: <short title>
- **Date:** YYYY-MM-DD
- **Status:** Proposed | Accepted | Superseded by ADR-NNN
- **Decided by:** <human / agent + session>

**Context:** What problem or force made this decision necessary.

**Options considered:**
1. Option A
2. Option B
3. Option C

**Decision:** What we chose.

**Why (how it was decided):** Criteria used (cost, complexity, fit with constraints, ecosystem, team skill) and how each option scored.

**Why not the others:** One line per rejected option.

**Consequences:** What gets easier, what gets harder, what we must watch.
```

---

## Index

| ADR | Title | Status |
|---|---|---|
| 001 | TypeScript over plain JavaScript | Accepted |
| 002 | npm workspaces monorepo | Accepted |
| 003 | Express 5 for the HTTP API | Accepted |
| 004 | MongoDB + Atlas Vector Search | Accepted |
| 005 | BullMQ + Redis for background jobs | Accepted |
| 006 | Vercel AI SDK for LLM orchestration | Accepted |
| 007 | Provider chain: Groq → Gemini → Ollama | Accepted |
| 008 | GitHub App integration | Accepted |
| 009 | Mongoose as the ODM | Accepted |
| 010 | Langfuse Cloud Hobby for LLM observability | Accepted |
| 011 | Next.js + shadcn/ui + Phosphor, guided by Taste-skill | Accepted |
| 012 | Vitest over Jest | Accepted |
| 013 | Node.js 22 LTS | Accepted |
| 014 | Toolchain baseline, TypeScript pinned to 6.0 | Accepted |
| 015 | Source export condition for workspace packages | Accepted |
| 016 | Webhook ingestion: own HMAC, delivery claim with reclaim, inline installation sync | Accepted |
| 017 | Review job id format and retention | Accepted (amended by 018) |
| 018 | Review run idempotency and crash recovery | Accepted |
| 019 | LLM wiring: AI SDK v7 structured output, strict-safe schema, own repair, Ollama provider | Accepted |
| 020 | Comment placement and noise limits | Accepted |
| 021 | Cross-pass merge of restated findings | Accepted |
| 022 | Langfuse SDK v5 adapter with an isolated OTel provider | Accepted |

---

## ADR-001: TypeScript over plain JavaScript
- **Date:** 2026-10-06
- **Status:** Accepted
- **Decided by:** Tridib Lahiri (human), on the agent's recommendation

**Context:** The requested stack was MERN/JavaScript. The system handles large untyped external payloads (GitHub webhooks) and LLM structured outputs where shape errors are the most common bug.

**Options considered:**
1. TypeScript (strict)
2. JavaScript + JSDoc types
3. JavaScript

**Decision:** TypeScript, strict mode, everywhere.

**Why:** Zod schemas give one source of truth for runtime validation **and** static types. Refactors across 4 packages + 3 apps stay safe. TypeScript is the #1 language on GitHub (Octoverse 2025) and is the 2026 hiring expectation.

**Why not the others:**
- JSDoc: verbose, and weak at enforcing discriminated unions across packages.
- Plain JS: shape bugs surface at runtime in async workers, where they are hardest to debug.

**Consequences:** A build/typecheck step is required. Run TS directly in dev with `tsx`.

---

## ADR-002: npm workspaces monorepo
- **Date:** 2026-10-06
- **Status:** Accepted
- **Decided by:** agent (setup session)

**Context:** 3 apps + 4 packages share schemas and types. The environment has npm 11.6.2; `pnpm` is installed but did not report a version.

**Options considered:**
1. npm workspaces
2. pnpm workspaces
3. Turborepo on top
4. Nx

**Decision:** npm workspaces, no task runner.

**Why:** Zero extra tooling, works with the installed npm. Root scripts with `-ws` / `-w <name>` are enough at this size.

**Why not the others:**
- pnpm: faster and stricter, but not verified working on this machine, and an extra install step.
- Turborepo: caching is valuable only once builds are slow.
- Nx: heavy configuration for a 7-workspace repo.

**Consequences:** No build caching. Revisit (new ADR) if CI exceeds ~10 min.

---

## ADR-003: Express 5 for the HTTP API
- **Date:** 2026-10-06
- **Status:** Accepted
- **Decided by:** agent (setup session)

**Context:** The API is small: webhooks + ~15 REST endpoints. The user's requested stack is MERN.

**Options considered:**
1. Express 5
2. Fastify
3. NestJS
4. Hono

**Decision:** Express 5.

**Why:** It matches MERN and has the largest middleware ecosystem (rate-limit, helmet). Express 5 handles rejected promises in route handlers natively. Raw-body access for HMAC verification is straightforward.

**Why not the others:**
- Fastify: faster, but throughput is not the bottleneck (LLM latency is).
- NestJS: decorators/DI add ceremony and hide the backend patterns this project wants to show.
- Hono: great on the edge, but we run a long-lived Node process next to BullMQ.

**Consequences:** We write our own validation and error middleware (small, and documented in Architecture.md §5).

---

## ADR-004: MongoDB + Atlas Vector Search
- **Date:** 2026-10-06
- **Status:** Accepted
- **Decided by:** agent (setup session)

**Context:** We need document storage for runs and findings, plus vector search for code context, at ~₹0.

**Options considered:**
1. MongoDB Atlas (M0) + Atlas Vector Search; `mongodb-atlas-local` in dev
2. MongoDB + separate Qdrant/Chroma
3. Postgres + pgvector
4. Pinecone

**Decision:** MongoDB with Atlas Vector Search; the `mongodb/mongodb-atlas-local` Docker image for dev and tests.

**Why:** One datastore for operational data and vectors (fewer moving parts). It is MERN-aligned. The M0 free tier allows vector search (max 3 search indexes; we use 1). atlas-local gives identical `$vectorSearch` behavior offline.

**Why not the others:**
- Separate vector DB: an extra service to run and keep in sync.
- pgvector: excellent, but leaves the MERN stack the user asked for.
- Pinecone: a paid-leaning, external dependency.

**Consequences:** M0 has 0.5 GB storage and pauses after 30 idle days. Keep `codeChunks` capped (content ≤ ~1,500 tokens, skip vendored/generated paths).

---

## ADR-005: BullMQ + Redis for background jobs
- **Date:** 2026-10-06
- **Status:** Accepted
- **Decided by:** agent (setup session)

**Context:** Reviews take 30-90 s and must survive crashes, retry with backoff, and de-duplicate by key.

**Options considered:**
1. BullMQ + Redis
2. Inngest
3. Upstash QStash
4. Temporal
5. Agenda (Mongo-backed)

**Decision:** BullMQ with a local/Docker Redis.

**Why:**
- Deterministic `jobId` gives free de-duplication.
- Built-in retries/backoff, concurrency control, and graceful shutdown.
- Runs fully locally at zero cost.
- Shows real queueing skills.

**Why not the others:**
- Inngest/QStash: hosted free tiers with execution caps (Inngest 50K/month, QStash 1K messages/day) and less control.
- Temporal: the right tool for long multi-day workflows, but overkill here.
- Agenda: polling-based, weaker semantics.

**Consequences:** BullMQ is command-heavy, so avoid Upstash's free Redis (500K commands/month) for BullMQ. Use a local or self-hosted Redis.

---

## ADR-006: Vercel AI SDK for LLM orchestration
- **Date:** 2026-10-06
- **Status:** Accepted
- **Decided by:** agent (setup session)

**Context:** We need provider-agnostic calls, Zod-validated structured output, embeddings, and token usage reporting.

**Options considered:**
1. Vercel AI SDK
2. LangChain.js / LangGraph.js
3. Mastra
4. Raw provider SDKs

**Decision:** Vercel AI SDK.

**Why:**
- One interface across Groq, Gemini and Ollama via provider packages.
- First-class Zod structured output.
- Usage metadata on every call.
- Small surface, and the most-downloaded TS AI SDK.

**Why not the others:**
- LangChain.js: heavier abstractions we don't need for 3 fixed passes.
- Mastra: promising, but its agent and workflow layer overlaps with BullMQ.
- Raw SDKs: we would rebuild the abstraction ourselves.

**Consequences:** Pin the SDK major version, because its APIs evolved fast across v5-v7. Wrap it behind our own `LlmProvider` interface so upgrades touch one package.

---

## ADR-007: Provider chain Groq → Gemini → Ollama
- **Date:** 2026-10-06
- **Status:** Accepted
- **Decided by:** agent (setup session)

**Context:** We need ₹0 inference with acceptable quality and resilience to free-tier quotas.

**Options considered:**
1. Single provider
2. Groq primary + Gemini fallback + Ollama last resort
3. OpenRouter `:free` models
4. LLM gateway (LiteLLM / Cloudflare AI Gateway)

**Decision:** Option 2, configured by env (model IDs not hard-coded).

**Why:**
- Groq is fast with a generous free tier (gpt-oss-120b, about 1K requests/day).
- Gemini Flash is strong, with a free tier.
- Ollama is unlimited and private, so it always works and is the default for private code.

**Why not the others:**
- Single provider: one quota exhaustion stops all reviews.
- OpenRouter free: 50 requests/day without credits.
- External gateway: another service to run. A simple fallback + circuit breaker in-process is enough.

**Consequences:**
- Gemini free-tier data may be used for training, so it is **excluded for private repos** unless the org opts in (`allowedProviders`).
- Output quality varies by provider, so record the provider per finding and compare in evals.

---

## ADR-008: GitHub App integration
- **Date:** 2026-10-06
- **Status:** Accepted
- **Decided by:** agent (setup session)

**Context:** We need to receive PR events and post reviews and check runs across many repos and orgs.

**Options considered:**
1. GitHub App
2. OAuth App
3. Personal access token + repo webhooks

**Decision:** GitHub App (with user-to-server OAuth for web sign-in via Auth.js).

**Why:**
- Fine-grained permissions and per-installation short-lived tokens.
- Org-level install, with one webhook endpoint for all repos.
- The Checks API is only available to Apps.
- Rate limits scale with installations.

**Why not the others:**
- OAuth App: acts as the user, has broad scopes, and no Checks API.
- PAT: tied to one person, a security risk, manual webhooks per repo.

**Consequences:** Must manage the App private key securely (env, never logged), and use smee.io for local webhook delivery.

---

## ADR-009: Mongoose as the ODM
- **Date:** 2026-10-06
- **Status:** Accepted
- **Decided by:** agent (setup session)

**Context:** We need schema definitions, index declarations, timestamps, and typed models.

**Options considered:**
1. Mongoose
2. Native `mongodb` driver + Zod
3. Prisma (Mongo)
4. Typegoose

**Decision:** Mongoose, wrapped by repository classes. Run `$vectorSearch` aggregations through `Model.aggregate()`.

**Why:** It is the standard MERN choice. Indexes and timestamps are declared in one place, and its typed schemas pair with Zod at the boundaries.

**Why not the others:**
- Native driver: more boilerplate for indexes and validation.
- Prisma on Mongo: limited aggregation and vector-search support.
- Typegoose: decorators, an extra layer.

**Consequences:** Use `.lean()` for reads to avoid hydration cost. The repositories hide Mongoose from services, so swapping later is contained.

---

## ADR-010: Langfuse Cloud Hobby for LLM observability
- **Date:** 2026-10-06
- **Status:** Accepted
- **Decided by:** agent (setup session)

**Context:** We need traces of every LLM call (prompt, output, tokens, latency, provider) to debug review quality and cost.

**Options considered:**
1. Langfuse Cloud Hobby (free)
2. Self-hosted Langfuse
3. LangSmith
4. Logs only

**Decision:** Langfuse Cloud Hobby; allow switching to self-hosted via `LANGFUSE_BASE_URL`.

**Why:** Free tier (50K units/month, 30-day retention). Open source, so self-hosting stays an option. It is the market leader (acquired by ClickHouse in Jan 2026) and in Thoughtworks Radar "Trial".

**Why not the others:**
- Self-hosting: needs Postgres + ClickHouse + Redis + S3-compatible storage, which is too heavy for a laptop.
- LangSmith: tighter LangChain coupling.
- Logs only: no prompt/response inspection.

**Consequences:** Prompts and code snippets leave the machine to Langfuse. For private repos, set `LANGFUSE_REDACT_INPUTS=true` (store metadata only).

---

## ADR-011: Next.js + shadcn/ui + Phosphor, guided by Taste-skill
- **Date:** 2026-10-06
- **Status:** Accepted
- **Decided by:** agent (setup session), skill requested by the human

**Context:** The UI should be a minimal but polished frontend that doesn't look AI-generated. The user asked to use the Taste-skill.

**Options considered:**
1. shadcn/ui + Tailwind v4
2. Primer (GitHub's DS)
3. Radix Themes
4. Plain Tailwind

**Decision:** Next.js App Router + Tailwind v4 + shadcn/ui (customized), Phosphor icons, Geist fonts.
- **Taste-skill** (`design-taste-frontend`) governs the landing page.
- **minimalist-ui** + Design.md govern the app screens, because Taste-skill excludes product UI.

**Why:**
- shadcn is owned code, so it is fully customizable to our tokens.
- It is Taste-skill's recommended choice for "modern SaaS where you own the components".
- Phosphor is first in Taste-skill's allowed icon list.

**Why not the others:**
- Primer: would make MergeMind look like GitHub itself, a brand confusion risk.
- Radix Themes: less control over the look.
- Plain Tailwind: we would rebuild accessible primitives ourselves.

**Consequences:**
- Replace shadcn's default Lucide icons with Phosphor on every component add.
- Never ship shadcn in its default styling.

---

## ADR-012: Vitest over Jest
- **Date:** 2026-10-06
- **Status:** Accepted
- **Decided by:** agent (setup session)

**Context:** We need fast TS-native testing across a monorepo, with ESM.

**Options considered:**
1. Vitest
2. Jest
3. node:test

**Decision:** Vitest (projects: `unit`, `int`), Playwright for E2E.

**Why:** Native ESM + TS without a Babel/ts-jest config. A Jest-compatible API, fast watch mode, built-in coverage (v8), and workspace projects.

**Why not the others:**
- Jest: ESM + TS needs extra transforms and is slower.
- node:test: a thin ecosystem for mocking and coverage reporting.

**Consequences:** Testcontainers needs Docker running for `npm run test:int`.

---

## ADR-013: Node.js 22 LTS
- **Date:** 2026-10-06
- **Status:** Accepted
- **Decided by:** agent (setup session)

**Context:** The local machine has Node v20.17.0. Node 20 reached end of life on 2026-04-30.

**Options considered:**
1. Stay on Node 20
2. Node 22 LTS
3. Node 24

**Decision:** Target Node 22 LTS (`.nvmrc` = `22`, `engines.node` = `>=22`).

**Why:** It is supported LTS with the widest library compatibility in 2026, and has native `fetch`, `--watch`, and a stable test runner.

**Why not the others:**
- Node 20: EOL, so no security fixes.
- Node 24: newer; fine later, but 22 has the broadest ecosystem support today.

**Consequences:** **Action for the human:** install Node 22 (e.g. via `nvm-windows` or `fnm`) before scaffolding. Until then, tooling may warn about `engines`.

---

## ADR-014: Toolchain baseline, TypeScript pinned to 6.0
- **Date:** 2026-10-06
- **Status:** Accepted
- **Decided by:** agent (Phase 1 scaffold session)

**Context:** At scaffold time the latest TypeScript is 7.0 (the native Go port). `typescript-eslint` 8.71, which we need for type-aware lint rules (`no-floating-promises`, `no-explicit-any`), declares `typescript >=4.8.4 <6.1.0` as its peer range.

**Options considered:**
1. TypeScript 7.0 and drop type-aware lint
2. TypeScript 7.0 with an unsupported typescript-eslint
3. TypeScript 6.0 (`~6.0.3`) with typescript-eslint `strictTypeChecked`

**Decision:** Pin `typescript@~6.0.3`. The rest of the baseline is the current major of each tool: Node 22.23, Express 5.2, Mongoose 9.11, BullMQ 6.3 + ioredis 6, Zod 4.6, pino 10, Vitest 5, ESLint 10 (flat config), Prettier 3, Next.js 16.3, React 19.3, Testcontainers 12.

**Why (how it was decided):** rules.md §2 and §6 depend on type-aware lint rules. Option 3 is the only one that keeps them supported. TS 6.0 is the last JS-based release and has the same strictness flags we use.

**Why not the others:**
- Option 1: loses `no-floating-promises`, which rules.md §6 requires.
- Option 2: unsupported peer range, so we would get silent breakage on upgrades.

**Consequences:**
- TS 6 defaults `types` to `[]`, so every tsconfig sets `"types": ["node"]` explicitly.
- Revisit (new ADR) when typescript-eslint supports TS 7.
- Vitest 5 needs Node `^22.12`, so `engines.node` is `>=22.12.0`.

---

## ADR-015: Source export condition for workspace packages
- **Date:** 2026-10-06
- **Status:** Accepted
- **Decided by:** agent (Phase 1 scaffold session)

**Context:** Apps import `@mergemind/*` packages. In dev and tests we want edits in a package to take effect immediately with no build step. In production we want plain `node dist/*.js`.

**Options considered:**
1. TypeScript project references + `tsc -b` before every dev run
2. Path aliases (`paths` + Vite aliases + tsx tsconfig-paths)
3. A custom export condition `@mergemind/source` pointing at `src/*.ts`, with `default` pointing at `dist/*.js`

**Decision:** Option 3. Every package's `exports` has `"@mergemind/source": "./src/index.ts"`, then `types`/`default` for `dist`. The condition is enabled by:
- `customConditions` in `tsconfig.base.json` (typecheck)
- `--conditions=@mergemind/source` in the `tsx` dev scripts
- `resolve.conditions` in `vitest.config.ts`

`tsconfig.build.json` clears `customConditions`, so builds resolve to the other packages' `dist`.

**Why (how it was decided):** It is one mechanism that every tool supports natively. It needs no build in dev, and production uses the standard resolution.

**Why not the others:**
- Project references: a build before every dev and test run, plus `composite` bookkeeping in 8 tsconfigs.
- Path aliases: would need configuring in three tools separately, and they leak into the emitted JS.

**Consequences:**
- `npm run typecheck` runs `tsc -p tsconfig.json` per workspace (not `tsc -b`). Each workspace typechecks the sources of the packages it imports.
- `npm run build` must run in dependency order. The root `workspaces` array is ordered for this: shared, then db/llm/github, then apps.
- `apps/web` (Next.js) will need `transpilePackages` plus a Turbopack condition when it starts importing packages in Phase 6.

---

## ADR-016: Webhook ingestion: own HMAC, delivery claim with reclaim, inline installation sync
- **Date:** 2026-10-06
- **Status:** Accepted
- **Decided by:** agent (Phase 2 session, plan approved by the human)

**Context:** PRD F1/F2 need verified, exactly-once webhook handling with a 202 in under 300 ms. GitHub never retries failed deliveries automatically, but a human can press "Redeliver", which resends the same `X-GitHub-Delivery` id.

**Options considered:**
1. `@octokit/webhooks` (verify + typed event emitter) and a plain unique insert for dedupe
2. Own HMAC check + a `webhookDeliveries` claim that can reclaim `failed` rows
3. Queue every event (installation events too) and do all writes in the worker

**Decision:** Option 2.
- `isValidWebhookSignature` (`apps/api/src/webhooks/verify-signature.ts`) runs `timingSafeEqual` over the raw body, on a route mounted before `express.json`.
- `webhookDeliveries.claim()` inserts the delivery. On a duplicate key it atomically reclaims the row if its status is `failed`, or `received` older than 5 min (a crashed request). Otherwise the response is `202 duplicate`.
- Installation events are synced inline (status `handled`): one upsert plus one `bulkWrite`. PR events only enqueue.

**Why (how it was decided):**
- The HMAC check is about 15 lines with no dependency, and is fully unit-tested.
- A plain unique insert would turn a delivery that failed mid-handling into a permanent "duplicate", so Redeliver could never fix it.
- Inline installation sync keeps F1 visible immediately and stays well inside the ack budget (measured 15-64 ms locally).

**Why not the others:**
- Option 1: adds a dependency and an event-emitter layer we don't need. Dedupe would still have the stuck-row problem.
- Option 3: needs a fourth queue and processor just for a couple of indexed writes.

**Consequences:**
- A very large installation (thousands of repos) makes `installation.created` slower. Revisit if acks exceed 300 ms.
- Delivery rows expire after 7 days (TTL). After that, the BullMQ job id (24 h) and the `reviewRuns` unique index (Phase 3) are the remaining dedupe layers.

---

## ADR-017: Review job id format and retention
- **Date:** 2026-10-06
- **Status:** Accepted, amended by ADR-018 (`-ready` suffix for `ready_for_review`)
- **Decided by:** agent (Phase 2 session, plan approved by the human)

**Context:** Architecture.md specified `<repoId>#<prNumber>@<headSha>`, with `:a<attempt>` for manual reruns. BullMQ throws `Custom Id cannot contain :` (verified in `bullmq/dist/esm/classes/job.js`). The handler should also build the id without a DB lookup.

**Options considered:**
1. Keep `:a<n>` and accept that reruns fail
2. `<githubRepoId>#<prNumber>@<headSha>-a<n>` using GitHub's numeric repo id
3. A hash of the tuple

**Decision:** Option 2, built only by `buildReviewJobId()` in `@mergemind/shared`. The first attempt has no suffix. Completed jobs are kept for 24 h (`removeOnComplete.age`), failed jobs for 7 days, with exponential backoff and 0.5 jitter.

**Why (how it was decided):**
- The id stays readable in logs and Redis.
- It is computable straight from the payload.
- Keeping completed jobs for a day makes BullMQ itself drop late duplicate enqueues.

**Why not the others:**
- Option 1: crashes at runtime.
- Option 3: opaque in logs, with no benefit.

**Consequences:**
- A PR reopened at the same SHA within 24 h is not re-reviewed (it already was). A manual rerun uses the `-a<n>` suffix.

---

## ADR-018: Review run idempotency and crash recovery
- **Date:** 2026-10-06
- **Status:** Accepted
- **Decided by:** agent (Phase 3 session, plan approved by the human)

**Context:** A `review.pr` job can be replayed (a duplicate enqueue that slips past BullMQ) or retried after a crash at any stage. PRD success metric: zero duplicate comments across redeliveries and re-pushes. LLM quota is scarce, so a retry should not pay for the passes twice.

**Options considered:**
1. Make every stage idempotent on its own, with no run state
2. A run record keyed by `(repositoryId, headSha, attempt)` with stage checkpoints, plus a marker in the posted review
3. A distributed lock per PR

**Decision:** Option 2.
- **Run record.** `reviewRuns.startOrResume()` upserts the run.
  - A `completed` run that actually reviewed is a replay and returns immediately.
  - A `skipped` run is re-evaluated, so draft → ready and budget resets work.
- **Checkpoints.** A resumed run reuses `checkRunId`. If `analyzedAt` is set, the persisted findings are loaded and the LLM is skipped.
- **Posting.** Before posting, the worker searches the PR's reviews for `<!-- mergemind:run=<runId> -->` and adopts a match. This covers a crash between GitHub accepting the review and our DB write.
- **Finding dedupe.** Findings are unique on `(pullRequestId, fingerprint)`, so an issue that survives a push is never posted again. It still counts toward the gate (`counts.duplicate`).
- **Amendment to ADR-017.** `ready_for_review` jobs get a `-ready` id suffix. Otherwise the draft-time `opened` job, which was skipped and is retained for 24 h, would make BullMQ drop the job that should review the PR. `pull_request.closed` cancels both ids.

**Why (how it was decided):** Option 2 gives exactly-once *effects* (one check run, one review, one LLM spend) using only Mongo unique indexes and a GitHub-side marker. These survive crashes at any point. It is proven by an integration test that kills the worker right after `createReview`.

**Why not the others:**
- Option 1: GitHub POSTs are not idempotent, so a crash after posting would duplicate the review.
- Option 3: locks expire on crash and still need the marker to detect a half-done post.

**Consequences:**
- A PR re-reviewed at the same SHA needs a manual rerun (`attempt` 2, Phase 6).
- Model text is sanitized (`sanitizeModelText`) so findings cannot forge the marker.

---

## ADR-019: LLM wiring: AI SDK v7 structured output, strict-safe schema, own repair, Ollama provider
- **Date:** 2026-10-06
- **Status:** Accepted
- **Decided by:** agent (Phase 3 session; summary-only behavior chosen by the human)

**Context:** AI SDK v7 deprecated `generateObject` in favor of `generateText({ output: Output.object(...) })`, and it has no output-repair hook. Groq's provider sends a strict JSON schema by default, and strict mode rejects optional keys. No official Ollama provider exists.

**Options considered:**
1. `generateObject` with `repairText` (deprecated API)
2. `generateText` + `Output.object` + a strict-safe schema + our own single repair re-ask
3. Disable strict mode (`strictJsonSchema: false`) and accept best-effort JSON

**Decision:** Option 2.
- **The schema** (`ReviewFindingOutputSchema`) has only required keys. `suggestion` is `string | null`, and ranges and lengths are not in the schema. `normalizeFinding` clamps confidence, orders line numbers, and trims and caps text after parsing.
- **Repair.** On `NoObjectGeneratedError` the model gets one re-ask on the same provider, with its previous text and a repair instruction. After that the chain moves to the next provider.
- **Retries and timeouts.** `maxRetries: 0`, because the chain owns retries, and `timeout: LLM_TIMEOUT_MS` on every call.
- **Ollama** goes through `ai-sdk-ollama@4`, which targets ai v7 and has built-in JSON repair suited to small local models.
- **Huge PRs** (summary_only) make **no** LLM call: the result is a notice and a neutral check. The human chose this to protect free-tier quota.
- **Langfuse** sits behind the `LlmTracer` interface with a no-op default until the account exists (Phase 3 M6).

**Why (how it was decided):** Option 2 uses only supported v7 APIs, keeps Groq's constrained decoding (which gives the fewest invalid outputs), and puts every validation rule in one tested function.

**Why not the others:**
- Option 1: a deprecated API with no future.
- Option 3: more invalid outputs and more repair calls on a quota-limited tier.

**Consequences:**
- Model ids still come only from env.
- Verify against a real Groq key with `npm run llm:smoke` before trusting it in production.
- Prompt changes bump `<pass>@N` and require `npm run eval` once Phase 7 lands.

---

## ADR-020: Comment placement and noise limits
- **Date:** 2026-10-06
- **Status:** Accepted
- **Decided by:** agent (Phase 3 session, plan approved by the human)

**Context:** PRD personas ask for pre-triaged PRs, with nits batched into one summary. GitHub rejects the **whole** review if one inline comment is not on a diff line. Noise is a tracked metric (dismiss rate < 30%).

**Options considered:**
1. Every finding inline
2. Critical and major inline (capped), minor and outside-diff in the review body
3. Everything in the body

**Decision:** Option 2.
- **Inline.** Only critical and major findings anchored to a commentable head-side line (`anchorFinding`), at most 25 (`maxInlineComments`). A multi-line comment is used only when both ends are in the same hunk.
- **Review body.** Minor findings ("Nits"), findings outside the diff, and inline overflow.
- **When to post.** No review is posted when there are no open findings, no failed passes and no policy errors. The check run alone reports success.
- **Filtering.** Findings below `minConfidence` are stored as `filtered` (for noise analysis) but never posted.

**Why (how it was decided):** Option 2 matches the PRD personas, makes a 422 impossible (every anchor is validated against the parsed hunks, and the fake GitHub in tests enforces the same rule), and keeps the PR timeline short.

**Why not the others:**
- Option 1: noisy, and one bad anchor fails the whole post.
- Option 3: loses the line context that makes findings actionable.

**Consequences:**
- The gate counts every open finding, including body-only and already-reported ones, so a blocking issue can't slip through by being outside the diff or re-pushed.

---

## ADR-021: Cross-pass merge of restated findings
- **Date:** 2026-10-06
- **Status:** Accepted
- **Decided by:** agent, at the human's request after the first live review

**Context:**
- **Live evidence:** the first live review (PR #1 on `dev_portfolio`) posted 8 inline comments for 4 planted bugs. The passes overlap in practice: the correctness and maintainability prompts still report injection, null-deref and missing-await issues that another pass already found.
- **Why dedupe missed them:** fingerprints include the pass (ADR-018 relies on that for stable identity), so these restatements were not deduplicated.
- **Measured:** a live re-run on the same file produced 14-16 raw findings for about 7 distinct issues.

**Options considered:**
1. Drop `pass` from the fingerprint
2. Merge after fingerprinting: same file + same category family + lines overlapping within ±2 → keep the strongest
3. Tighten the prompts only

**Decision:** Option 2, in `classifyFindings` (`apps/worker/src/pipeline/post-process.ts`).
- **Order:** findings are processed strongest first, so the kept one is the most severe, then the most confident.
- **Claimed regions:** posted, already-reported and suppressed findings all claim their region. So a restatement of a suppressed issue stays suppressed, and one of an already-reported issue is never posted as "new".
- **Low confidence:** a below-threshold finding claims nothing, so it can't swallow a confident one.
- **Exclusions:** `other` never merges. `injection` and `unchecked-input` form one family, because unchecked input reaching a query on the same lines *is* the injection.
- **Count:** merges are counted in `reviewRuns.counts.merged` and shown in the review footer.

**Why (how it was decided):**
- Fingerprints stay stable, so ADR-018 is unchanged.
- The rule is pure and unit-tested with the exact live examples.
- **Measured live** on the same file with Groq gpt-oss-120b:
  - Without the family rule: 14 raw → 4 merged.
  - With it: 16 raw → 7 merged → 6 inline + 3 nits, each planted bug reported exactly once.

**Why not the others:**
- Option 1: two passes legitimately flag different problems on the same code; without the pass they would collide.
- Option 3: worth doing too (prompt `@2`), but it needs the Phase 7 eval to measure, and models still restate across passes.

**Consequences:**
- Two genuinely different issues of the same category within 2 lines collapse into one comment. That's acceptable for a first-pass reviewer.
- Revisit with eval data. Candidate prompt change: tell the maintainability pass not to report correctness categories.

---

## ADR-022: Langfuse SDK v5 adapter with an isolated OTel provider
- **Date:** 2026-10-06
- **Status:** Accepted
- **Decided by:** agent, at the human's request (Phase 3 M6)

**Context:** ADR-010 chose Langfuse Cloud. The current Langfuse JS SDK (v5, `@langfuse/tracing` + `@langfuse/otel`) is OpenTelemetry-based, and the old `langfuse` v3 SDK is legacy. Langfuse organizations created on or after 2026-09-16 cannot use the legacy read API (`GET /api/public/traces` returns 410), so reading back means `GET /api/public/v2/observations`. The review pipeline already calls a small `LlmTracer` interface after every LLM call.

**Options considered:**
1. Langfuse v5 with the global OTel provider (`NodeTracerProvider.register()`) and `propagateAttributes`
2. Langfuse v5 with an isolated provider (`setLangfuseTracerProvider`), trace attributes set directly on each span
3. The legacy `langfuse` v3 SDK, or raw calls to the ingestion API

**Decision:** Option 2, in `packages/llm/src/langfuse-tracer.ts` (`createLangfuseTracer`).
- **Spans:** one `generation` observation per LLM call, carrying model, `version` (prompt version), `usageDetails` and real start and end times (from the measured latency).
- **Level:** outcome `ok` maps to level `DEFAULT`; any other outcome maps to `WARNING` with a `statusMessage`.
- **Trace attributes:** set on the span itself (`session.id = runId`, trace name, tags), so one review run is one Langfuse session.
- **Redaction:** with `LANGFUSE_REDACT_INPUTS=true` (the default), private repos send metadata only; input and output become `[redacted: private repository]`.
- **Safety:** `record()` catches and logs errors, so tracing can never fail a review. The worker calls `tracer.shutdown()` (which flushes) after the review worker closes.
- **Switch:** tracing is on only when both keys are set (enforced by worker env validation); otherwise `noopTracer` is used.

**Why (how it was decided):**
- Option 2 uses the supported SDK without installing a global OTel provider or context manager, so it doesn't interfere with any future OTel instrumentation.
- `propagateAttributes` silently did nothing without a context manager (caught by a unit test), so setting the attributes directly on each span is the reliable path.
- **Verified live:** `npm run llm:smoke` produced a `GENERATION "review.security"` in Langfuse, with the matching model, usage (945/979), latency (2.737 s), version and session.

**Why not the others:**
- Option 1: global side effects for a single span source.
- Option 3: legacy, and new orgs are already losing legacy endpoints.

**Consequences:**
- Read-back tooling must use the v2 observations API.
- The Vitest config dropped the `module` resolve condition, because `@opentelemetry/api` maps it to a bundler-only ESM build that Node can't load.
