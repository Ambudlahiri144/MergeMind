# MergeMind: Product Requirements Document

| | |
|---|---|
| **Product** | MergeMind, an agentic code review and PR intelligence service |
| **Status** | Pre-build (docs phase) |
| **Owner** | Ambud Lahiri |
| **Last updated** | 2026-10-06 |
| **Related docs** | [Architecture.md](Architecture.md), [Decisions.md](Decisions.md), [Testing.md](Testing.md), [Design.md](Design.md), [rules.md](rules.md) |

---

## 1. Problem statement

Code review is the slowest step in most engineering teams' delivery pipeline. A team of 50 developers opens 100+ pull requests a day, and each one waits hours (often a full day) for a human reviewer. Reviewers spend much of that time on things a machine could catch:
- leaked secrets
- injection risks
- missing error handling
- off-by-one logic
- style drift

When CI fails, engineers scroll through thousands of log lines to find the one that matters.

**MergeMind** is a GitHub App that runs a senior-engineer-level first-pass review on every PR within minutes, and explains CI failures in plain language. Human reviewers spend their time only on what needs judgment.

### Where the problem statement comes from
| Source | Idea |
|---|---|
| Keploy, GSoC 2025 | *AI-Powered Open-Source Code Review Agent* (Hard, 350h) and *OSS Code Indexer for Efficient Retrieval* (Medium, 350h). github.com/keploy/gsoc/tree/main/2025 |
| Rocket.Chat, GSoC 2025 | *Code Review Assistant*: PR monitoring, reviewer scoring, LLM first-pass review |
| Jenkins, GSoC 2025 | *Domain-specific LLM on ci.jenkins.io data*: agentic CI failure diagnosis |

### Market evidence (2025-2026)
- CodeRabbit: $1.5B valuation, 2M+ reviews per week, 17,000+ customers.
- Uber uReview: analyzes 90%+ of ~65,000 diffs per week; 75% of comments rated useful.
- Cloudflare runs an AI reviewer on 100% of standard merge-request pipelines.
- Cursor acquired Graphite in December 2025.

---

## 2. Personas

| Persona | Need | What MergeMind gives them |
|---|---|---|
| **Developer** (PR author) | Fast, specific feedback before a human looks | Inline comments within minutes, re-reviewed on every push |
| **Tech lead** (reviewer) | Spend review time only where judgment is needed | PRs arrive pre-triaged by severity, and nits are batched into one summary comment |
| **On-call engineer** | Know why CI is red without reading 5,000 log lines | A CI failure summary comment that names the failing step, the likely cause, and the evidence lines |
| **Org admin** | Control cost, privacy and noise | Per-org token budget, provider allowlist for private repos, a policy file per repo |

---

## 3. Core features (MVP)

| # | Feature | Acceptance criteria |
|---|---|---|
| F1 | **GitHub App install** | An org or user installs the app on selected repos. The `installation` and `installation_repositories` events create and update records, and uninstalling disables the repos. |
| F2 | **Webhook-driven PR review** | `pull_request` events (`opened`, `reopened`, `synchronize`, `ready_for_review`) trigger a review. The webhook responds `202` in under 300 ms, and all work runs async. |
| F3 | **Multi-pass LLM review** | Three passes run in parallel: `security`, `correctness` and `maintainability`. Every finding is Zod-validated JSON containing `severity`, `confidence`, `path`, `lineStart`, `lineEnd`, `title`, `body` and `suggestion?`. |
| F4 | **Severity gate (Check Run)** | A `mergemind/review` Check Run is created as `in_progress` and finished with a conclusion. Its conclusion is `failure` when a finding meets `gate.failOn` (default `critical`), and `success` or `neutral` otherwise. |
| F5 | **Incremental re-review** | A push to the PR re-reviews only the hunks that changed since the last reviewed `headSha`. Comments whose code was fixed are resolved, and identical findings are never posted twice. |
| F6 | **Code-context index** | The default branch is chunked by symbol and embedded into `codeChunks`. Reviews retrieve the top-k related chunks (callers, definitions) as context. The index is refreshed on pushes to the default branch. |
| F7 | **`.mergemind.yml` policy** | A per-repo policy file controls passes, minimum confidence, ignored paths, the gate, the size limit, skipping drafts, and persona. It is read at the PR's `headSha`; if missing or invalid, safe defaults apply and the invalid file is reported in the summary. |
| F8 | **Confidence filter + suppressions** | Findings below `minConfidence` (default 0.7) are dropped. A developer can dismiss a finding, which creates a suppression (by fingerprint) for that repo. |
| F9 | **Per-org token budget** | Every LLM call is recorded in `usageLedger`. At 80% of the monthly budget, the run summary warns. At 100%, reviews are skipped with a `neutral` check explaining why. |
| F10 | **CI failure summary** | A `workflow_run` event that completes with conclusion `failure` on a PR branch fetches the failed job logs, extracts the relevant window, and posts one summary comment citing log lines. |
| F11 | **Thin web UI** | Next.js app with GitHub sign-in, repositories, PR detail with review runs, run detail with findings, and settings for policy view and budget. See [Design.md](Design.md). |

### Out of scope for MVP
- Writing code fixes as commits
- Platforms other than GitHub
- Billing and payments
- Analytics dashboards and charts (deliberately excluded)
- Fine-tuning models

---

## 4. Future features (post-MVP)

1. **GitLab and Bitbucket adapters** behind the same `ReviewSource` interface.
2. **Auto-fix suggestions** as GitHub suggested changes, then as a commit on a bot branch.
3. **Reviewer recommendation**, scored from file ownership and past review history (the Rocket.Chat GSoC idea).
4. **Learned repo conventions**: mine merged PRs and accepted or dismissed findings to tune prompts per repo.
5. **MergeMind MCP server**, exposing review history and findings to coding agents (Keploy GSoC 2026 pattern).
6. **Slack and Discord digests**, a daily summary per team.
7. **Ollama-only sovereign mode**: a fully offline deployment where no code leaves the network.
8. **Org-level rule packs**: shared custom rules such as "never call `fetch` without a timeout".

---

## 5. Tech stack

| Layer | Choice |
|---|---|
| Language | TypeScript (strict), Node.js 22 LTS |
| Monorepo | npm workspaces |
| API | Express 5 (`apps/api`) |
| Background jobs | BullMQ + Redis (`apps/worker`) |
| Database | MongoDB with Mongoose, Atlas Vector Search (Atlas M0 in cloud, `mongodb/mongodb-atlas-local` in dev) |
| LLM orchestration | Vercel AI SDK, provider chain Groq, then Gemini, then Ollama |
| Embeddings | Ollama `nomic-embed-text` (local, free) |
| GitHub | GitHub App via Octokit (`@octokit/app`) |
| Observability | pino logs, Langfuse (LLM traces) |
| Frontend | Next.js (App Router), Tailwind v4, shadcn/ui, Phosphor icons, Geist fonts |
| Auth (web) | Auth.js with the GitHub provider |
| Testing | Vitest, Supertest, Testcontainers, MSW, Playwright, custom eval runner |
| Local infra | Docker Compose (atlas-local, Redis), smee.io webhook proxy |

Every choice has an ADR in [Decisions.md](Decisions.md).

---

## 6. Constraints

| Constraint | Detail | How we respect it |
|---|---|---|
| **Cost ~ ₹0** | Portfolio project with no paid infra | Free tiers (Groq, Gemini, Atlas M0, Langfuse Hobby), local Ollama, Docker |
| **LLM free-tier quotas** | Groq gpt-oss is about 1K requests/day; Gemini free limits change often | Provider fallback chain with circuit breaker, per-org budget, diff size cap, summary-only mode for huge PRs |
| **GitHub API rate limits** | 5,000 req/h per installation token (more for larger orgs) | Conditional requests (ETag), batching comments into one review, backoff on `403`/`429` with a `retry-after` |
| **Webhook delivery semantics** | GitHub may redeliver, and events can arrive out of order | Idempotency by `X-GitHub-Delivery`, and job id keyed by `repo#pr@headSha` |
| **Privacy** | Private code must not go to providers that train on it | For private repos, an org-level `allowedProviders` list. Gemini free tier is excluded unless the org opts in. |
| **Secrets** | App private key, webhook secret, API keys | Env vars only, never logged. Validated at boot with Zod. |
| **Runtime** | Node 22 LTS (Node 20 reached end of life in April 2026) | `.nvmrc` and the `engines` field |

---

## 7. Success metrics and validation

| Metric | Target | How it is measured |
|---|---|---|
| **Review precision** | ≥ 0.70 | Eval runner on the seeded-bug benchmark (`npm run eval`) |
| **Review recall** (critical + major) | ≥ 0.50 | Same benchmark |
| **Webhook ack latency** | p95 < 300 ms | pino timing logs, integration test assertion |
| **Time to review** (PR < 500 changed lines) | p95 ≤ 90 s from webhook to Check Run completed | `reviewRuns.timings`, k6 or autocannon replay |
| **Duplicate comments** | 0 across redeliveries and re-pushes | Integration test that replays the same delivery 3 times, then fingerprint checks |
| **Cost visibility** | 100% of LLM calls recorded with tokens and provider | `usageLedger` count matches Langfuse trace count |
| **Noise** | Developer dismiss rate < 30% on the demo repo | `findings.state = dismissed` ratio |

### Validation plan
1. **Unit and integration suites green** in CI (see [Testing.md](Testing.md)).
2. **Seeded-bug benchmark:** at least 30 small PR fixtures with known injected bugs (SQL injection, missing `await`, null deref, secret in code, unbounded query, and others) plus 10 clean PRs to measure false positives.
3. **Live demo:** install on a real public repo and open 10 PRs covering clean, buggy, huge, draft and CI-failing cases. Record a 2-minute walkthrough.
4. **Chaos check:** kill the worker mid-review, then confirm the job retries and no comment is duplicated.
