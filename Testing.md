# MergeMind: Testing Strategy

---

## 1. Test pyramid and scope

```
            ┌───────────┐
            │  E2E (few) │  Playwright: critical user journeys in apps/web
          ┌─┴───────────┴─┐
          │  LLM evals     │  seeded-bug benchmark: quality of review output
        ┌─┴───────────────┴─┐
        │  Integration       │  real Mongo (atlas-local) + Redis via Testcontainers,
        │                    │  mocked GitHub + LLM over HTTP
      ┌─┴───────────────────┴─┐
      │  Unit (many, fast)     │  pure functions, no IO
      └───────────────────────┘
```

| Layer | Scope | Tool | Speed budget | Runs |
|---|---|---|---|---|
| **Unit** | Pure logic in `packages/*` and service functions with injected deps | Vitest | whole suite < 20 s | every save (watch), every PR |
| **Contract** | Recorded GitHub webhook payloads parse with our Zod schemas; `.mergemind.yml` fixtures | Vitest | < 5 s | every PR |
| **Integration** | HTTP routes, webhook pipeline, worker processors, Mongo queries and indexes, BullMQ behavior | Vitest + Supertest + Testcontainers + MSW | < 3 min | every PR |
| **E2E** | Sign in (mocked) → repos → PR → run detail; dismiss finding; a11y | Playwright + `@axe-core/playwright` | < 5 min | every PR touching `apps/web`, nightly |
| **LLM evals** | Precision/recall of real review passes on seeded bugs | `evals/` runner (`npm run eval`) | ~10-20 min (quota-bound) | on demand, nightly, required for prompt changes |
| **Load (smoke)** | Webhook ack latency under burst | autocannon | 1 min | before demo / release |

---

## 2. Frameworks and libraries

| Need | Tool | Notes |
|---|---|---|
| Test runner (unit, contract, integration) | **Vitest** | Root `vitest.config.ts` with projects `unit` and `int` |
| Coverage | `@vitest/coverage-v8` | |
| HTTP assertions | **Supertest** | Against `createApp()` from `apps/api/src/app.ts` (no port binding) |
| Real Mongo + vector search | **Testcontainers** with `mongodb/mongodb-atlas-local` | One container per test run, a fresh DB per test file |
| Real Redis | Testcontainers `redis:7-alpine` | |
| HTTP mocking (GitHub REST, Groq, Gemini, Ollama) | **MSW** (`msw/node`) | One tool for all outbound HTTP. Unhandled requests **fail** the test (`onUnhandledRequest: 'error'`) |
| LLM mocking at SDK level | AI SDK mock language/embedding models (`ai/test`) | For unit tests of `packages/llm` |
| Time | `vi.useFakeTimers()` / injected `Clock` | Backoff, TTL, budget periods |
| Browser E2E | **Playwright** | Chromium in CI, all 3 engines locally on demand |
| Accessibility | `@axe-core/playwright` | Zero serious/critical violations |
| Load | autocannon | Replays signed webhook payloads |

---

## 3. Where tests live

```
packages/<pkg>/src/**/<name>.test.ts           unit (colocated)
packages/shared/test/fixtures/github/*.json    recorded webhook payloads (sanitized)
packages/shared/test/fixtures/policy/*.yml     .mergemind.yml fixtures (valid + invalid)
apps/api/test/integration/*.int.test.ts        api integration
apps/worker/test/integration/*.int.test.ts     worker integration
apps/web/e2e/*.spec.ts                         Playwright
evals/fixtures/<case-id>/                      { diff.patch, context/, expected.json }
evals/src/run-evals.ts                         eval runner
test/setup/                                    shared Testcontainers + MSW setup
```

---

## 4. What must be tested (minimum)

### Unit
- **Diff parser:** added/removed/renamed files, binary files, hunk headers, line mapping to head side.
- **Chunker:** respects token budget and never splits a hunk mid-line.
- **Policy:** `.mergemind.yml` merge with defaults; invalid YAML → defaults + reported errors.
- **Severity gate:** each `failOn` value × finding mixes → expected conclusion.
- **Fingerprint:** stable under line shifts and whitespace changes; differs across paths and passes.
- **CI log window:** timestamps and ANSI stripped, failing step's section only, `##[error]`-anchored windows within 150 lines / 8 KB, tail fallback without markers, original line numbers, token redaction.
- **Post-processing:** dedupe, suppression filter, confidence filter, ordering.
- **Provider chain:** fallback on 429, 5xx, timeout and schema failure; circuit breaker opens after 3 failures and half-opens after cooldown; private-repo allowlist enforced.
- **Budget:** 80% warn and 100% skip thresholds; month rollover.
- **HMAC verify:** valid, invalid, missing header, tampered body.

### Integration
- **Webhook endpoint:** signed `pull_request.opened` → 202 + one job enqueued with the deterministic `jobId`.
- **Idempotency:** the same delivery posted 3× → one `webhookDeliveries` row, one job.
- **Concurrency:** two deliveries for the same `headSha` → one review run.
- **Review processor end to end:** mocked GitHub diff + mocked LLM findings, asserting:
  - one review is posted with N inline comments
  - the check run is completed with the right conclusion
  - findings are persisted
  - `usageLedger` rows are written
- **Incremental re-review:** second push → only new hunks sent to the LLM; fixed finding marked `resolved`; no duplicate comments.
- **Crash recovery:** the worker throws after publish-stage step 1 → retry completes without duplicating comments.
- **Index processor:** a first full index stores symbol chunks and marks the repo ready. A later push re-embeds only changed symbols and deletes removed files. A redelivered head is skipped. A private repo without Ollama on its allowlist is never embedded.
- **Vector search:** the index is created on atlas-local; `$vectorSearch` returns the seeded chunk filtered by `repositoryId`.
- **API:** auth required (401 without JWT, 403 for a foreign installation); cursor pagination; `problem+json` error shape.
- **CI summary:** `workflow_run` failure → logs fetched (MSW) → one comment upserted (not duplicated on redelivery). Also covered:
  - a re-run attempt updates the same comment, and a late older attempt never overwrites it;
  - a later success marks the comment passing, with no LLM call;
  - fork PRs are found by head SHA, and a moved PR head skips the run;
  - private repo outside the allowlist, exhausted budget, or provider outage on the last attempt → excerpt-only comment;
  - expired logs are reported in the comment; `ciSummary.enabled: false` skips the run.
- **Repository visibility:** `repository.publicized`/`renamed` update a tracked repo; an unknown repo is ignored; a job payload may only escalate a repo to private (ADR-027).

### E2E
- Sign-in (Auth.js mocked provider), then repository list, then PR, then run detail with findings.
- Dismiss a finding → it disappears from open findings, and the suppression is created.
- Empty, loading and error states render.
- Light and dark themes; mobile viewport (390×844) has no horizontal page scroll.
- axe passes on every screen.

### LLM evals
- At least **30 buggy fixtures** across categories, plus **10 clean fixtures** for false positives. Categories:
  - SQL/NoSQL injection
  - hard-coded secret
  - missing `await`
  - null/undefined deref
  - unbounded query
  - unchecked user input
  - race condition
  - resource leak
  - off-by-one
  - swallowed error
- A finding **matches** when path matches, the line range overlaps the expected range, and the category matches.
- **Gates** (from PRD): precision ≥ 0.70, recall (critical+major) ≥ 0.50.
- The output report goes to `evals/reports/<date>-<promptVersion>.json` and is summarized in the console.

---

## 5. Test patterns

- **Arrange-Act-Assert,** with a blank line between the three blocks.
- **Test names describe behavior:** `it('returns 202 and enqueues one job for a duplicate delivery')`.
- **Factories over fixtures** for domain objects: `buildFinding({ severity: 'critical' })` in `@mergemind/shared/testing`. Use JSON fixtures only for third-party payloads.
- **Inject dependencies** (clock, logger, octokit, llm, repos). This keeps services testable without module mocking. Avoid `vi.mock` of our own modules.
- **No real network** in unit, contract or integration tests: MSW fails on unhandled requests. Only `npm run eval` calls real LLMs.
- **Deterministic:** fixed clock, seeded IDs where order matters, no `sleep`. Wait on BullMQ job completion events.
- **Isolated DB per test file:** a unique database name; dropped in `afterAll`.
- **One assertion focus per test.** Multiple `expect`s are fine when they describe one behavior.
- **Snapshot tests only** for stable rendered markdown (review summary comment). Never snapshot LLM output.

---

## 6. Coverage targets

| Area | Lines | Branches |
|---|---|---|
| `packages/*` | ≥ 80% | ≥ 75% |
| `apps/api`, `apps/worker` | ≥ 60% | ≥ 50% |
| `apps/web` | covered by E2E journeys; no line target | |

Coverage is a floor, not a goal. Critical paths (gate, fingerprint, HMAC, idempotency, provider fallback) need 100% branch coverage.

---

## 7. Commands

| Command | Runs |
|---|---|
| `npm test` | Vitest `unit` project (unit + contract) |
| `npm run test:watch` | Vitest unit in watch mode |
| `npm run test:int` | Vitest `int` project (needs Docker running) |
| `npm run test:e2e` | Playwright (starts api, worker, web against test containers) |
| `npm run test:cov` | unit + int with coverage report |
| `npm run eval` | LLM eval runner (needs real provider keys or Ollama) |

---

## 8. CI order

1. `npm ci`
2. `npm run lint`
3. `npm run typecheck`
4. `npm test` (unit + contract)
5. `npm run test:int`
6. `npm run test:e2e` (only if `apps/web` or `apps/api` changed)
7. Nightly: `npm run eval` (posts the report as an artifact)

A red step stops the pipeline. Never skip or `.only` tests in committed code; `it.skip` needs a linked issue.
