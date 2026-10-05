# memory.md: MergeMind running context

> **Purpose:** a new session (human or AI) reads this file first and knows exactly where the project stands.
>
> **Update protocol (mandatory, end of every session):**
> 1. Rewrite the **Current state** block so it is true right now.
> 2. Append a new entry at the **top** of the **Session log** (newest first), with date, what was done, what was decided (link the ADR), and what is unfinished.
> 3. Update **Next steps** and **Open questions / blockers**.
> 4. Keep entries short: facts and file paths, no essays. Move anything permanent into the right doc (PRD, Architecture, rules, Decisions, Testing, Design) and link it from here.

---

## Current state
| | |
|---|---|
| **Phase** | 3: Review pipeline (PRD F3, F4, F7, F8, F9) **complete, including M6 Langfuse tracing**. Verified with fakes, real Groq, a live GitHub App review (PR #1, now closed), and Langfuse ingestion. Phase 4 not started. |
| **Code** | **worker:** full `review.pr` pipeline (`apps/worker/src/pipeline/`), registered only when the GitHub App env is set. **llm:** Groq → Gemini → Ollama chain, breaker, 3 prompts (`@1`), `llm:smoke`. **github:** Octokit App client, diff parser, anchoring, markdown, MSW fake. **shared:** policy, gate, fingerprint, budget, findings schema. **db:** reviewRuns, findings, suppressions, usageLedger. |
| **Tests** | 222 unit/contract, 46 integration (incl. 14 end-to-end pipeline tests with crash recovery). Lint, typecheck, format and build are green. |
| **Git** | `main`, **no commits yet**; Phases 1-3 are untracked, waiting for the human. |
| **Last session** | 2026-10-06 (cross-pass merge + Langfuse) |
| **Next action** | **Human:** commit; delete the `mergemind-test` branch on `dev_portfolio`. **Agent:** plan Phase 4 (incremental review + code index) in plan mode. |

## Next steps
1. **Human:** review and commit. Suggested split: `chore: scaffold monorepo (phase 1)`, `feat(api): webhook ingestion (phase 2)`, `feat(worker): review pipeline (phase 3)`.
2. **Phase 4:** incremental review (compare `lastReviewedSha...headSha`, resolve fixed findings) and the code index (F5, F6). `retrieveContext` is a no-op in `run-review.ts` and `push` is still ignored. Atlas M0 needs the `code_chunks_vector` search index (create it through the Atlas UI or API).
3. **Phase 5:** CI failure summary (F10).
4. **Phase 6:** web UI (F11) plus the dismiss-finding endpoint (creates suppressions via `suppressions.suppress`) and manual rerun (`attempt` 2, job id `-a2`). Set `AUTH_SECRET` then.
5. **Phase 7:** evals. Prompts are `<pass>@1`; record the baseline before any prompt change. Candidate prompt fix: the maintainability pass should not report correctness categories (ADR-021).
6. **Human setup still open:** Ollama install (local fallback; currently unreachable, so the chain's last resort fails).

## Open questions / blockers
- Live setup works: App `mergemind-review` installed on `dev_portfolio` (private), webhook secret set (via API), Atlas reachable (db `mergemind`), Groq, Gemini and Langfuse keys set.
- `AUTH_SECRET` is empty (needed in Phase 6).
- Langfuse org is new (after 2026-09-16), so read traces through `GET /api/public/v2/observations` (the legacy `/api/public/traces` returns 410).
- Security note: `.mergemind.yml` is read at the PR **head** SHA (as the PRD says), so a PR author can change the policy in their own PR, e.g. `gate.failOn: never`. Consider reading it from the base branch (PRD change) before going public.
- GitHub App name: "MergeMind" may already be taken; pick a fallback slug (e.g. `mergemind-review`).
- Verify Groq free-tier limits and the current Gemini Flash model id in their consoles.
- Large installations: `installation.created` syncs repos inline (ADR-016). Revisit if acks exceed 300 ms.

## Key file pointers
| What | Where |
|---|---|
| Research backup (all 10 ideas, scoring, use cases, business logic) | `A:\AI_Backend_Problem_Statements_Plan.md` |
| Product requirements | [PRD.md](PRD.md) |
| Agent handbook | [AGENTS.md](AGENTS.md) (imported by [CLAUDE.md](CLAUDE.md)) |
| Architecture, schema, API, queues | [Architecture.md](Architecture.md) |
| Rules | [rules.md](rules.md) |
| Decisions (ADR-001..020) | [Decisions.md](Decisions.md) |
| Testing strategy | [Testing.md](Testing.md) |
| Design system | [Design.md](Design.md) |
| Installed skills | `.agents/skills/design-taste-frontend/`, `.agents/skills/minimalist-ui/` (+ `.claude/skills/` junctions, gitignored; `skills-lock.json`) |
| API app factory / server | [apps/api/src/app.ts](apps/api/src/app.ts), [apps/api/src/server.ts](apps/api/src/server.ts) |
| Shared errors / env / logger | [packages/shared/src/](packages/shared/src/) |
| Integration test containers | [test/setup/containers.ts](test/setup/containers.ts) |
| Webhook pipeline | [apps/api/src/services/webhook.service.ts](apps/api/src/services/webhook.service.ts), [apps/api/src/webhooks/](apps/api/src/webhooks/) |
| Review pipeline | [apps/worker/src/pipeline/run-review.ts](apps/worker/src/pipeline/run-review.ts) (stages in the same folder) |
| LLM chain + prompts | [packages/llm/src/review-pass.ts](packages/llm/src/review-pass.ts), [packages/llm/src/prompts/](packages/llm/src/prompts/) |
| GitHub client + fake | [packages/github/src/client.ts](packages/github/src/client.ts), [packages/github/src/testing/fake-github.ts](packages/github/src/testing/fake-github.ts) |
| Review rules (policy, gate, fingerprint, budget) | [packages/shared/src/review/](packages/shared/src/review/) |
| Webhook fixtures + send script | [packages/shared/test/fixtures/github/](packages/shared/test/fixtures/github/), [scripts/send-webhook.ts](scripts/send-webhook.ts) |

## Environment notes
- Windows 11, PowerShell 5.1 + Git Bash. Repo: `A:\Projects\Mergemind`.
- Tool versions:
  - Node 22.23.2 (installed via winget on 2026-10-06; replaced v20.17.0 system-wide)
  - npm 11.6.2
  - Docker 29.4.0. Docker Desktop must be running for compose and `test:int`.
  - git 2.34.1
- TypeScript is pinned to `~6.0.3` (ADR-014). Do not upgrade to 7 until typescript-eslint supports it.
- Another local project's container `macro_redis` holds host port 6379. The local `.env` sets `REDIS_HOST_PORT=6380` and `REDIS_URL=redis://localhost:6380`. Mongo uses 27017.
- Ollama: not installed.
- The worker review pipeline needs `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY`; without them it logs `review.disabled` and jobs wait in Redis.

---

## Session log (newest first)

### 2026-10-06: close PR #1, cross-pass merge, Langfuse (Phase 3 M6)
- **Closed** PR #1 on `dev_portfolio` via the App (`state: closed`, not merged). MergeMind processed the close (`handled/pr_closed`). The branch `mergemind-test` still exists.
- **Cross-pass merge (ADR-021)** in `classifyFindings`:
  - Rule: same file + same category family (`injection` ≈ `unchecked-input`) + lines within ±2 → keep the strongest finding.
  - `other` never merges. Suppressed and already-reported findings claim their region; low-confidence ones do not.
  - New `reviewRuns.counts.merged`, shown in the review footer.
  - Live measurement on the PR #1 file: 16 raw → 7 merged → 6 inline + 3 nits, each planted bug once (before: 8 inline for 4 bugs).
- **Langfuse (ADR-022):**
  - `createLangfuseTracer` (SDK v5 + an isolated `NodeTracerProvider`); one `generation` per call; `session.id` = runId; private repos redacted by default.
  - Worker env gains `LANGFUSE_*` (both keys or neither), tracer shutdown on SIGTERM, and `llm:smoke` traces too.
  - Verified in Langfuse via the v2 observations API: model, usage 945/979, latency 2.737 s, version `security@1`, session.
  - `propagateAttributes` needs a global context manager, so attributes are set on `otelSpan` instead.
- **Vitest:** removed the `module` resolve condition, because `@opentelemetry/api` maps it to an ESM build Node can't load.
- **Gate:** 222 unit + 46 integration tests, lint, typecheck, format and build all green. api, worker and smee are still running in the background (the worker has tracing on).

### 2026-10-06: first live review on GitHub
- **Verified:** Atlas connects (db `mergemind`). App `mergemind-review` is installed on `Ambudlahiri144` with 1 repo: `dev_portfolio` (**private**, default branch `master`). Because the repo is private, the chain is groq → ollama; Gemini is excluded by the allowlist (ADR-007).
- **Live run:** a PR #1 with a planted-bug file `mergemind-test/users.js` was opened by the human.
  - The first deliveries all got 401: **the App had no webhook secret** (GitHub sends no signature without one). Set it through `PATCH /app/hook/config` from the `.env` value (the human approved), then redelivered.
  - Result: 202 → job `947921021#1@3d018db…` → `review.completed` in 12 s (LLM 2.5 s). Check `mergemind/review` failure, "Blocking findings: 2 critical, 6 major".
  - One review with 8 inline comments covering all 4 planted bugs (hard-coded key, SQL injection, missing await, `rows[0]` deref), plus 2 nits in the body. No errors.
- **Quality issue found (open):** **cross-pass duplicates.** The same issue is reported by several passes (SQL injection as security/critical and correctness/major; missing await twice; null deref twice; hard-coded key again as a minor nit). The fingerprint includes `pass`, so they are not merged. Proposed fix: merge findings across passes with the same path + category + overlapping lines, keeping the most severe.
- **Gotchas:**
  - GitHub delivery ids exceed `Number.MAX_SAFE_INTEGER`, so read them from raw JSON text before calling `POST /app/hook/deliveries/{id}/attempts`.
  - The smee command is `npx -p smee-client smee ...` (docs fixed).
- api, worker and smee were left running in the background for follow-up tests.

### 2026-10-06: second .env check
- **GitHub key:** the human pasted the PEM body as 25 lines without BEGIN/END. I verified the body (RSA 2048, PKCS#1), folded it into one `GITHUB_APP_PRIVATE_KEY` line with `\n` escapes, and confirmed against GitHub: `GET /app` returns `mergemind-review` (owner Ambudlahiri144) with the right events and permissions, but 0 installations. Worker and api env loaders both validate. The temporary backup was deleted.
- **Shell gotcha:** this Bash tool turns `\\n` inside inline `node -e` strings into a real newline. Build backslashes with `String.fromCharCode(92)` or use a script file.
- **Gemini:** `LLM_FALLBACK_MODEL=gemini-3.5-flash-lite` is set, so the chain is groq → gemini → ollama. Gemini itself is not live-tested yet.
- **Atlas:** the IP is now allowed (the server is reachable), but auth fails (`bad auth`). The human must reset the DB user password.

### 2026-10-06: .env check + first live Groq run
- **Checked the human-configured `.env`** (values never printed).
  - Groq key works.
  - `GITHUB_APP_PRIVATE_KEY` is the fingerprint, not the PEM.
  - Atlas `MONGODB_URI` is not reachable from this IP.
  - `LLM_FALLBACK_MODEL` and `AUTH_SECRET` are empty.
  - Langfuse keys are present.
- **Bug fixed** (found by the live run): Groq rejects schema-invalid output server-side with `400 json_validate_failed`. That is an `APICallError`, not a `NoObjectGeneratedError`, so the repair re-ask never ran and the chain fell through to Ollama. `isServerSchemaRejection` in `packages/llm/src/review-pass.ts` now routes it to the single repair, quoting the validator error. Two regression tests added; 210 unit tests green.
- `scripts/llm-smoke.ts` now logs each `provider.fallback` and prints every call even on failure.
- **Live:** `npm run llm:smoke -- security` (2 runs) → Groq `openai/gpt-oss-120b` found the planted SQL injection (critical 0.95-0.96) and the missing `await`, in ~3 s and ~1.9K tokens per run.

### 2026-10-06: Phase 3 review pipeline
**Done** (plan approved in plan mode; the human chose no-LLM summary_only and Langfuse as the last milestone):
- **M1 shared:** `review/` policy (yaml + picomatch), findings schema (strict-safe) + `normalizeFinding`, gate, fingerprint, budget, diff types. Policy fixtures + contract tests. `FINDING_CATEGORIES` moved to shared; evals uses them.
- **M2 db:** reviewRuns (`startOrResume`, checkpoints), findings (upsert on `pullRequestId+fingerprint`), suppressions, usageLedger (sum per period), `pullRequests.setLastReviewedSha`.
- **M3 github:** `createGithubApp` (@octokit/app + rest + throttling + retry, per-attempt 15 s timeout), `parsePatch`/`commentableLines`/`anchorFinding`, markdown renderers with marker + sanitization, `@mergemind/github/testing` fake.
- **M4 llm:** `createProviderChain`, `createReviewLlm` (fallback, single repair, allowlist, breaker), prompts `security@1`/`correctness@1`/`maintainability@1`, `LlmTracer` no-op, `scripts/llm-smoke.ts`.
- **M5 worker:** pipeline stages + `runReview`, processor adapter, env (GitHub App + LLM vars), conditional review worker.
- **Bug fixed** (found while building): `ready_for_review` shared the draft-time job id and would have been dropped by BullMQ. It now gets `-ready`, close cancels both ids, and skipped runs are re-evaluated (ADR-018).

**Verified:** lint, typecheck, format, build. 208 unit + 46 integration tests, including end to end: one review per run, off-diff findings only in the body (the fake 422s otherwise), crash after `createReview` adopts the review (one POST, no second LLM spend), re-push does not re-post but still gates, budget skip with 0 LLM calls, draft → ready, invalid/valid policy, summary_only notice, superseded SHA, all-providers-down retry then neutral, unknown installation resolved via the GitHub API. Worker boots with reviews disabled when the App env is missing. `llm:smoke` runs and fails clearly without keys or Ollama.

**Decided:** ADR-018 (run idempotency, marker adoption, `-ready` amendment to ADR-017), ADR-019 (AI SDK v7 `Output.object`, nullable strict-safe schema, own repair, `ai-sdk-ollama`, no-LLM summary_only), ADR-020 (critical/major inline ≤ 25, minor + outside-diff in the body, no review when there is nothing to say).

**Not verified:** real Groq/Gemini/Ollama responses, a real GitHub App, and Langfuse (needs keys and accounts).

**Unfinished:** M6 Langfuse. Nothing committed.

### 2026-10-06: Phase 2 webhook ingestion
**Done** (plan approved in plan mode):
- **shared:** domain enums, webhook header + payload Zod schemas, `ReviewPrJobDataSchema`, `buildReviewJobId`, `QUEUE_JOB_OPTIONS`, `assertNever`, `validationErrorFromZod`, and the `@mergemind/shared/testing` subpath (signing + fixture loader). Ten sanitized fixtures + contract tests.
- **db:** 4 models with Architecture §4 indexes (+ TTL), 4 repository factories, `ensureDbIndexes()`.
- **api:** `verify-signature`, `route-webhook`, handlers, `webhook.service`, controller + raw-body router, `review.producer`. Also `GITHUB_WEBHOOK_SECRET` env and 413-style client errors mapped to problem+json.
- **worker:** `review.pr` stub processor registered with `REVIEW_CONCURRENCY` and graceful `worker.close()`.
- **scripts:** `scripts/send-webhook.ts` + `npm run webhook:send`.
- Local `.env` got a random `GITHUB_WEBHOOK_SECRET`.

**Verified:** lint, typecheck, format, 112 unit + 27 integration tests. Live run: installation.created handled, PR opened enqueued as `77700001#42@a1b2...`, worker `review.deferred` with PR upserted, same delivery resent was `duplicate`, push `ignored`. Webhook acks took 15-64 ms.

**Decided:** ADR-016 (own HMAC, delivery claim with reclaim of failed/stale rows, inline installation sync), ADR-017 (job id `-a<n>` suffix because BullMQ forbids `:`; 24 h completed retention). Schema additions in Architecture §4: `repositories.isInstalled`, optional `defaultBranch`, `pullRequests.githubUpdatedAt`, delivery `handled`/`reason`/`attempts`.

**Deviation from plan:** installation and installation_repositories handlers share one file (`installation.handler.ts`). The worker stub defers instead of creating an installation it has never seen, because a pull_request payload lacks the account login/type.

**Unfinished:** nothing committed. Phase 3 not started.

### 2026-10-06: Phase 1 scaffold
**Done:**
- The human approved the docs ("start the build") and chose to install Node 22 via winget (`OpenJS.NodeJS.22`, 22.23.2).
- `git init -b main`. Added `.gitignore`, `.gitattributes`, `.nvmrc`, `.prettierrc.json`, `.prettierignore`, `.env.example`, and a local `.env` (gitignored).
- Root `package.json` with 8 ordered workspaces and every AGENTS.md §4 script. Also `tsconfig.base.json`, root `tsconfig.json`, `eslint.config.js` (flat config, strictTypeChecked, bans enum/default exports/console), and `vitest.config.ts` (projects `unit`, `int`).
- `docker-compose.yml` with `mongodb/mongodb-atlas-local:8.0` + `redis:7-alpine` (noeviction) and configurable host ports.
- `test/setup/containers.ts`: Testcontainers global setup that provides `mongoUri`/`redisUrl` through `inject()`. Types are in `test/setup/provided-context.d.ts`.
- `@mergemind/shared`: `AppError` family (problem+json), `parseEnv` + env fragments, `withTimeout`, `registerGracefulShutdown`, constants (queues, jobs, providers), and `createLogger` with redaction (subpath `@mergemind/shared/logger`).
- `@mergemind/db`: `connectMongo`/`disconnectMongo`/`pingMongo` + integration test. `@mergemind/llm`: private-repo provider allowlist. `@mergemind/github`: `parseRepoFullName`. `evals`: finding-match rule; `npm run eval` exits 1 until Phase 7.
- `apps/api`: `createApp()` (helmet, pino-http request ids, `/api/v1/health`, `/api/v1/ready`, 404 + error handler) and `server.ts` (Mongo + Redis, graceful shutdown).
- `apps/worker`: env (concurrency defaults), BullMQ-ready Redis connection, `main.ts`.
- `apps/web`: Next.js 16 placeholder + `buildApiUrl`.

**Verified:** lint, typecheck, format:check, 53 unit tests, 2 integration tests, full `npm run build`, `npm start` of the compiled api, and `npm run dev` with web 200 and api `/ready` showing Mongo and Redis up.

**Decided:** ADR-014 (toolchain baseline, TypeScript pinned to 6.0), ADR-015 (`@mergemind/source` export condition, so typecheck is per-workspace `tsc -p` instead of `tsc -b`). Updated AGENTS.md §4/§7 and Architecture.md §2/§5/§7.

**Unfinished:** Nothing is committed yet. `test:e2e` is a no-op until Phase 6.

### 2026-10-06: Research + project setup
**Done:**
- Researched GSoC 2025/2026, LFX 2026, SIH 2024/2025/2026 and other hackathons, plus 2025-26 industry trends. Ranked the top 10 AI-integrated backend problem statements (difficulty, trend, cost, AI involvement), each with a use case, daily enterprise use and business logic.
- Backed up the full plan to `A:\AI_Backend_Problem_Statements_Plan.md`.
- The human chose **Idea #1 (Agentic Code Review & PR Intelligence)**, named it **MergeMind**, and chose **TypeScript**.
- Installed Taste-skill (`design-taste-frontend`) + `minimalist-ui` via `npx skills add` into `.agents/skills/` (Claude Code junctions in `.claude/skills/`).
- Wrote PRD.md, AGENTS.md, CLAUDE.md, Design.md, Architecture.md, rules.md, memory.md, Decisions.md (ADR-001..013), Testing.md.

**Decided:** ADR-001..013 (TypeScript, npm workspaces, Express 5, Mongo + Atlas Vector Search, BullMQ, Vercel AI SDK, Groq → Gemini → Ollama, GitHub App, Mongoose, Langfuse Cloud, Next.js + shadcn + Phosphor, Vitest, Node 22).

**Design call:** Taste-skill governs only the landing page (the skill itself excludes product UI). App screens follow Design.md + minimalist-ui.

**Unfinished:** No code. Waiting for the human to review the docs.
