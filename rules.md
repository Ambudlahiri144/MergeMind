# MergeMind: Engineering Rules

> These rules are binding for humans and AI agents. If a rule blocks you, propose a change in a PR that also updates this file and adds an entry to [Decisions.md](Decisions.md). Never silently break a rule.

---

## 1. Naming conventions

| Thing | Convention | Example |
|---|---|---|
| Variables, functions, methods | `camelCase`, verb-first for functions | `fetchPullRequestDiff`, `headSha` |
| Booleans | `is` / `has` / `should` / `can` prefix | `isDraft`, `hasCriticalFinding`, `shouldSkipReview` |
| Types, interfaces, classes, enums, React components | `PascalCase`, no `I` prefix | `ReviewRun`, `SeverityGate`, `FindingCard` |
| Zod schemas | `PascalCase` + `Schema` suffix; inferred type drops the suffix | `ReviewFindingSchema` → `type ReviewFinding` |
| Constants (module-level, immutable) | `UPPER_SNAKE_CASE` | `DEFAULT_MIN_CONFIDENCE`, `MAX_DIFF_LINES` |
| Environment variables | `UPPER_SNAKE_CASE` | `GITHUB_WEBHOOK_SECRET` |
| Files and folders | `kebab-case`, role suffix where useful | `review.processor.ts`, `diff-parser.ts`, `repositories.routes.ts` |
| React component files | `kebab-case.tsx` exporting a `PascalCase` component | `finding-card.tsx` → `FindingCard` |
| Unit tests | `*.test.ts` next to the source file | `diff-parser.test.ts` |
| Integration tests | `*.int.test.ts` in `test/integration/` | `webhook.int.test.ts` |
| E2E tests | `*.spec.ts` in `apps/web/e2e/` | `run-detail.spec.ts` |
| Mongo collections | plural `camelCase` | `reviewRuns`, `usageLedger`, `codeChunks` |
| Mongoose models | singular `PascalCase` | `ReviewRun`, `Finding` |
| BullMQ queues | lowercase noun | `review`, `index`, `ci-summary` |
| BullMQ job names | `<queue>.<object>` | `review.pr`, `index.repo`, `ci-summary.run` |
| Domain events / log event names | `<entity>.<pastTenseVerb>` | `review.completed`, `webhook.ignored`, `provider.fallback` |
| API routes | plural nouns, kebab-case, no verbs except sub-resource actions | `/api/v1/repositories/:repositoryId/reindex` |
| Route params | `camelCase` + `Id` | `:repositoryId`, `:runId` |
| Git branches | `<type>/<short-kebab>` | `feat/incremental-review`, `fix/hmac-timing` |
| Prompt versions | `<pass>@<int>` | `security@2` |

---

## 2. TypeScript

**Do:**
- `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
- Infer types from Zod (`z.infer`) rather than duplicating interfaces.
- Prefer `type` aliases for data shapes, and `interface` only for extensible contracts (e.g. `LlmProvider`).
- Use discriminated unions for states (`status: 'queued' | 'running' | ...`), and add `switch` exhaustiveness checks with `assertNever`.
- Use named exports only.
- Import across packages with `@mergemind/<pkg>`, never with relative `../../packages/...`.

**Don't:**
- `any`. Use `unknown` and narrow with Zod or type guards.
- Non-null assertions (`!`) outside tests.
- `@ts-ignore`. Use `@ts-expect-error` only with a reason comment.
- Default exports. The exception is Next.js files that require them: `page.tsx`, `layout.tsx`, `route.ts` handlers, `next.config.ts`.
- `enum`. Use `as const` objects + union types.

---

## 3. Validation and boundaries

- **Validate everything external with Zod** at the boundary: HTTP bodies/params/queries, webhook payloads, env vars, `.mergemind.yml`, **LLM outputs**, and job data when a job is dequeued.
- Shared schemas live in `@mergemind/shared`. Apps never define their own copy of a shared shape.
- Env is parsed once at boot (`config/env.ts`). A missing or invalid env var crashes the process with a clear message.

---

## 4. Architecture rules

- **LLM calls only in `packages/llm`.** Apps call `reviewPass()`, `summarizeCiLogs()`, `embed()`, and never a provider SDK directly.
- **GitHub API calls only in `packages/github`.**
- **Database access only through repositories in `packages/db`.** Services never import Mongoose models directly.
- **Controllers are thin:** parse, then call the service, then respond. Business logic lives in services or pure functions.
- **Pure business rules** (gate, policy merge, fingerprint, confidence filter) are pure functions with no IO, unit-tested.
- **Webhook handlers never do slow work.** They verify, record, enqueue, and return 202.
- **Every job is idempotent.** Running it twice must produce the same end state.
- `packages/llm` and `packages/github` do not import each other. Apps compose them.

---

## 5. Errors and logging

**Do:**
- Throw `AppError` subclasses from `@mergemind/shared` (`NotFoundError`, `ValidationError`, `ConflictError`, `UpstreamError`, `RateLimitedError`, `BudgetExceededError`). Each one maps to an HTTP status and a `problem+json` type.
- Log with **pino**, as structured JSON. Every line carries `requestId` (api) or `jobId` (worker). Event names follow `<entity>.<pastTenseVerb>`.
- Configure pino `redact` for `authorization`, `*.token`, `*.privateKey`, `*.apiKey`, `*.secret`, `cookie`.
- Use log levels on purpose: `error` (needs action), `warn` (degraded but handled, e.g. provider fallback), `info` (lifecycle), `debug` (dev only).

**Don't:**
- `console.log` anywhere except throwaway scripts in `scripts/`.
- Swallow errors (`catch {}`). Either handle the error meaningfully or rethrow with context (`cause`).
- Log full diffs, file contents, or LLM prompts at `info`. Langfuse holds prompts; logs hold IDs.
- Return stack traces to clients.

---

## 6. Async, performance and data

- Always use `async/await`. No floating promises (eslint `no-floating-promises`).
- Bound concurrency with `p-limit` for fan-out (LLM passes, GitHub file fetches).
- Every external call has a **timeout** (GitHub 15 s, LLM `LLM_TIMEOUT_MS`, embeddings 30 s).
- **No unbounded queries.** Every `find` has a filter that uses an index, a `limit`, and a projection. Use `.lean()` for reads.
- Paginate with a cursor, never with `skip` on large collections.
- Every index is declared in the Mongoose schema and listed in Architecture.md §4.
- **No magic numbers.** Name them as constants in the module or in `@mergemind/shared/constants`.

---

## 7. LLM and prompt rules

- Prompts live in `packages/llm/src/prompts/<pass>.prompt.ts` as exported `{ version, system, buildUser }`. Never inline prompt strings elsewhere.
- **Bump `version`** on any prompt change, and run `npm run eval` before and after. Paste both results into the PR description.
- Use `temperature: 0` for review passes.
- Every LLM output is parsed with its Zod schema. If parsing fails, make one repair attempt, then fall back to the next provider, then fail the pass (the run still completes with the other passes).
- Every call records a `usageLedger` row and a Langfuse trace.
- **Private repos:** only providers in `installation.allowedProviders`. Never send code to a provider outside that list.
- Never put secrets, tokens or env values into a prompt.

---

## 8. Security

- Verify webhook signatures with `crypto.timingSafeEqual` on `X-Hub-Signature-256` **before** parsing JSON (verify the raw body).
- Use installation access tokens, which are short-lived and cached until 5 min before expiry. Never use a PAT.
- Sanitize markdown from LLM output before rendering in web (`rehype-sanitize`). On GitHub it is rendered by GitHub.
- Use least-privilege GitHub App permissions:
  - Pull requests: read & write
  - Checks: read & write
  - Contents: read
  - Actions: read
  - Metadata: read
- Never commit `.env`. Keep `.env.example` current whenever a variable is added.
- Dependencies: no new runtime dependency without a one-line justification in the PR. Prefer well-maintained packages.

---

## 9. Frontend rules

- Follow [Design.md](Design.md). Use tokens only, with no raw hex in components.
- Use Server Components by default. `'use client'` only on interactive leaf components.
- Fetch from `apps/api` through `src/lib/api-client.ts` only.
- Use **zero em-dashes and en-dashes** in UI copy.
- Use Phosphor icons only. Use shadcn/ui as the single component system.

---

## 10. Git and PR workflow

- Use **Conventional Commits**: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `perf:`, with a scope (`feat(worker): incremental review`).
- Keep one concern per PR. Aim for under 400 changed lines.
- Before pushing, all of these must pass locally: `npm run lint && npm run typecheck && npm test`.
- If a PR changes behavior described in a doc, it updates that doc.
- Non-trivial technical choices add an ADR to [Decisions.md](Decisions.md).

---

## 11. Never do

1. Commit secrets, keys, or `.env`.
2. Call an LLM or GitHub outside their packages.
3. Do slow work inside the webhook request.
4. Post review comments without fingerprint de-duplication.
5. Send private code to a provider not on the allowlist.
6. Use `any`, `console.log`, default exports (outside Next.js special files), or swallowed errors.
7. Run unbounded DB queries or `skip`-based pagination on large collections.
8. Mix design systems or icon sets. Use em-dashes in UI.
9. Mark work as done without running the relevant tests.
10. End a session without updating [memory.md](memory.md).
