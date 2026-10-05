# AGENTS.md: MergeMind project handbook for AI agents

> This file is for any coding agent (Claude Code, Copilot, Gemini CLI, Cursor, Codex, ...). `CLAUDE.md` imports it. Keep it accurate: if you change a workflow, command, or location, update this file in the same change.

## 1. Project in five lines
- **MergeMind** is a GitHub App that runs an AI first-pass code review on every pull request and explains CI failures.
- It is backend-heavy: an Express 5 webhook API, BullMQ workers, a multi-pass LLM review pipeline, and MongoDB with vector search for code context.
- The frontend is a deliberately thin Next.js app (no dashboards).
- Everything runs at ~₹0: free LLM tiers (Groq, Gemini) plus local Ollama, Docker for Mongo/Redis.
- Language: **TypeScript (strict)**, Node **22 LTS**, npm workspaces monorepo.

## 2. Read before you work (in this order)
1. [memory.md](memory.md): **current state, last session, next steps. Always read first.**
2. [PRD.md](PRD.md): what we are building and the acceptance criteria.
3. [Architecture.md](Architecture.md): system diagram, folders, DB schema, API, queues.
4. [rules.md](rules.md): naming, do/don't, binding rules.
5. [Decisions.md](Decisions.md): why things are the way they are (ADRs).
6. [Testing.md](Testing.md): test types, tools, patterns.
7. [Design.md](Design.md): only when touching `apps/web`.

## 3. Where things live
| Path | What |
|---|---|
| `apps/api` | Express 5 server: `/webhooks/github` + `/api/v1/*` |
| `apps/worker` | BullMQ processors (`review`, `index`, `ci-summary`) + review pipeline stages |
| `apps/web` | Next.js App Router UI (Auth.js GitHub sign-in) |
| `packages/shared` | Zod schemas, types, constants, `AppError` classes, test factories |
| `packages/db` | Mongoose connection, models, repositories |
| `packages/llm` | Provider chain, prompts, structured output, usage + tracing |
| `packages/github` | Octokit App client, diff parser, review/check publisher |
| `evals/` | Seeded-bug benchmark fixtures + eval runner |
| `.agents/skills/` | Installed skills: `design-taste-frontend` (Taste-skill), `minimalist-ui`. `.claude/skills/` holds junctions to these. `skills-lock.json` pins them. |
| Root docs | `PRD.md`, `Architecture.md`, `rules.md`, `Decisions.md`, `Testing.md`, `Design.md`, `memory.md` |

The full tree is in Architecture.md §2.

## 4. Commands
Run from the repo root.

| Command | Purpose |
|---|---|
| `npm install` | Install all workspaces |
| `docker compose up -d` | Start MongoDB (atlas-local, with vector search) + Redis. Host ports come from `MONGO_HOST_PORT` / `REDIS_HOST_PORT` in `.env` |
| `npm run dev` | Run api (4000) + worker + web (3000) together |
| `npm run dev -w @mergemind/api` | Run one workspace |
| `npm test` | Unit + contract tests (Vitest) |
| `npm run test:int` | Integration tests (needs Docker) |
| `npm run test:e2e` | Playwright E2E |
| `npm run test:cov` | Coverage report |
| `npm run eval` | LLM eval benchmark (real providers or Ollama) |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc -p tsconfig.json` in the root and every workspace (ADR-015) |
| `npm run build` | Compile packages and apps to `dist/` (in workspace order), plus `next build` |
| `npm run format:check` | Prettier check (no writes) |
| `npm run format` | Prettier write |
| `npm run llm:smoke -- [pass]` | Run one real review pass (`security`, `correctness` or `maintainability`, default `security`) on a planted-bug diff against the configured providers (needs `GROQ_API_KEY` or a running Ollama) |
| `npm run webhook:send -- <fixture> [deliveryId]` | Sign a fixture from `packages/shared/test/fixtures/github/` with `.env`'s `GITHUB_WEBHOOK_SECRET` and POST it to the local api (no GitHub App needed) |

**Local webhooks:** `npx -p smee-client smee -u $SMEE_URL -t http://localhost:4000/webhooks/github`.
**Local models:** `ollama pull nomic-embed-text` and `ollama pull qwen2.5-coder:7b`.

> **Status note:** Phases 1-3 are done (scaffold, webhook ingestion, review pipeline with Langfuse tracing). All commands above work. `npm run test:e2e` is a no-op and `npm run eval` exits 1 until Phases 6 and 7 add them.
>
> **Test fakes:** `@mergemind/shared/testing` (signed webhooks, fixtures) and `@mergemind/github/testing` (`createFakeGithub()`: MSW GitHub REST fake that rejects off-diff review comments like GitHub does, plus `createTestPrivateKey()`). The worker pipeline takes all dependencies via `ReviewDeps`, so tests inject a scripted `ReviewLlm` instead of mocking modules.
>
> **How packages resolve (ADR-015):** in dev and tests, `@mergemind/*` imports load `src/*.ts` through the `@mergemind/source` export condition, so no build is needed. Production (`npm start`) loads `dist/`. Every new package needs the same `exports` shape as `packages/shared/package.json`.

## 5. Workflows

### 5.1 Feature
1. Find the requirement in PRD.md (feature ID, e.g. F5). If none exists, ask the human or add it to the PRD first.
2. Design: update Architecture.md if a schema, endpoint, queue, or flow changes.
3. Write or extend Zod schemas in `@mergemind/shared`.
4. Write failing tests (unit first, then integration).
5. Implement in the right layer (rules.md §4).
6. Run `npm run lint && npm run typecheck && npm test` (+ `test:int` if IO is touched).
7. Update docs. Add an ADR if you made a non-trivial choice. Update memory.md.

### 5.2 Bug fix
1. Reproduce with a failing test first.
2. Fix at the root cause, not the symptom.
3. Keep the regression test. Note the fix in memory.md.

### 5.3 Add or change an LLM review pass or prompt
1. Edit or add `packages/llm/src/prompts/<pass>.prompt.ts` and **bump `version`**.
2. Update or add the output Zod schema if the shape changes.
3. Run `npm run eval` before and after. Precision/recall must not drop below the PRD gates.
4. Record the results in the PR description and in memory.md.

### 5.4 Add an API endpoint
1. Add the row to the Architecture.md §5 endpoint table.
2. Put the request and response Zod schemas in `@mergemind/shared`.
3. Wire route → controller → service → repository. Use the `validate()` middleware and auth middleware.
4. Write an integration test with Supertest covering 2xx, 400, 401/403 and 404.

### 5.5 Handle a new webhook event
1. Add a sanitized payload fixture under `packages/shared/test/fixtures/github/`.
2. Add its schema plus a contract test.
3. Add a route in `apps/api/src/webhooks/route-webhook.ts` and a handler in `webhooks/handlers/`. Handlers only record or enqueue (bounded indexed writes at most, ADR-016) and return a `HandlerResult`; the real work goes in a worker processor.
4. Add an idempotency test for redelivery.

### 5.6 UI work
1. Read Design.md. The landing page follows the Taste-skill (`.agents/skills/design-taste-frontend/SKILL.md`). App screens follow Design.md + `minimalist-ui`.
2. Run the Design.md §8 pre-flight checklist and the Playwright axe test.

## 6. Rules you must respect
These are a summary. [rules.md](rules.md) is binding.
- **Never** commit secrets or `.env`. Add new variables to `.env.example` and to Architecture.md §7.
- **LLM calls only in `packages/llm`. GitHub calls only in `packages/github`. DB only via repositories in `packages/db`.**
- **Validate every external input with Zod**: HTTP, webhooks, env, `.mergemind.yml`, LLM output, and job data.
- Webhook handlers never do slow work. Every job is idempotent. Never post a comment without fingerprint dedupe.
- Never send private-repo code to a provider outside `installation.allowedProviders`.
- No `any`, no `console.log`, no default exports (outside Next.js special files), no swallowed errors, no unbounded queries.
- **Run the relevant tests before saying something is done**, and report failures honestly.
- **Record non-trivial choices as an ADR** in Decisions.md: what was chosen, why, how, and why not the alternatives.
- **Update [memory.md](memory.md) at the end of every session** (protocol at the top of that file).
- Don't scaffold, install dependencies, or change the architecture without the human's go-ahead when memory.md says the phase needs approval.

## 7. Environment facts
- Windows 11, PowerShell + Git Bash available. Repo root is `A:\Projects\Mergemind`.
- Docker 29.x and git 2.34 are installed.
- Node 22.23.2 (installed via winget, ADR-013). TypeScript is pinned to 6.0 (ADR-014), so do not upgrade it to 7.
- Another local project (`macro_redis`) already uses host port 6379, so this machine's `.env` publishes MergeMind Redis on **6380**.
- `.claude/skills/` holds junctions and is gitignored. After a fresh clone, recreate them with `npx skills add`.
- The research backup with the other 9 project ideas is at `A:\AI_Backend_Problem_Statements_Plan.md`.
