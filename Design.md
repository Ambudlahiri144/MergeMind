# MergeMind: Design System

> Derived from the installed **Taste-skill** (`.agents/skills/design-taste-frontend/SKILL.md`, by Leonxlnx, MIT) and its sibling **minimalist-ui** (`.agents/skills/minimalist-ui/SKILL.md`). Where this file and a skill disagree, **this file wins** for MergeMind.

---

## 0. Scope: which rules apply where

The Taste-skill itself says it is for landing pages and portfolios, **not** dense product UI (its Section 13). So we split it:

| Surface | Governing rules |
|---|---|
| **Landing page** (`/`) | Full Taste-skill: brief inference, dials, hero discipline, pre-flight check (Section 14 of the skill) |
| **App screens** (`/repos`, PR, run, settings) | Tokens and components in this file + minimalist-ui component specs. Taste-skill rules on color lock, shape lock, contrast, em-dash ban, icons and copy still apply. |

**Design read:** *Reading this as: a developer-tool product site plus a quiet web app for engineers and tech leads, with a calm, trustworthy, Linear-style minimalist language, leaning toward shadcn/ui on Tailwind v4 + Geist + near-static motion.*

**Explicitly not a dashboard.** No KPI tile grids, no charts, no "analytics" page. Numbers appear inline in text or small tables where they answer a question.

---

## 1. Dials

| Dial | Value | Reason |
|---|---|---|
| `DESIGN_VARIANCE` | **3** | Predictable, symmetric grids. Engineers scan, they don't explore. |
| `MOTION_INTENSITY` | **3** | Static. Only `:hover`/`:active`/focus transitions. No scroll animations. |
| `VISUAL_DENSITY` | **6** | "Daily app": findings lists and diffs need moderate density; landing uses 4. |

---

## 2. Foundations

### 2.1 Design system
- **shadcn/ui** components (owned code in `apps/web/src/components/ui`), **customized**: never ship the default state. One system only. No Material, Radix Themes, or Primer mixed in. Phase 6 writes them in the shadcn way (`cva` variants + `cn`), and the dialog is the native `<dialog>` (focus trap and Escape built in), so no primitive library is needed yet (ADR-029).
- **Tailwind v4** with `@tailwindcss/postcss`. Tokens are defined as CSS variables in `apps/web/src/app/globals.css` under `@theme`.
- **Icons:** `@phosphor-icons/react`, **Regular** weight in UI, **Bold** for emphasis, size 16/20. No Lucide (shadcn's default; replace on install), no hand-drawn SVG icons.
- **Fonts:** `geist` package via `next/font` (Geist Sans + Geist Mono). No Inter, Roboto, Open Sans, and **no serif** anywhere.

### 2.2 Color tokens

One palette (cool neutrals) + **one accent: Cobalt**. No purple, no gradients, no glow, no pure `#000`/`#fff`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F6F7F9` | `#0F1115` | page canvas |
| `--surface` | `#FCFCFD` | `#16191F` | cards, panels, inputs |
| `--surface-muted` | `#EEF0F3` | `#1D2129` | code blocks, table headers, hover rows |
| `--border` | `#E1E4E8` | `#2A2F38` | 1px borders and dividers |
| `--text` | `#14161A` | `#E8EAED` | primary text |
| `--text-muted` | `#5B6370` | `#9AA3AF` | secondary text, metadata |
| `--accent` | `#2B54C9` | `#7393EC` | primary buttons, links, focus ring |
| `--accent-hover` | `#2346A8` | `#8DA7F0` | hover of accent |
| `--accent-fg` | `#FCFCFD` | `#0F1115` | text on accent |
| `--accent-subtle` | `#E7EDFB` | `#1C2540` | selected row, active nav item background |

**Severity colors are semantic state, not accents.** They are used only on severity badges, the gate result, and a diff line marker. Never use them for decoration.

| Token | Light (fg / bg) | Dark (fg / bg) |
|---|---|---|
| `--sev-critical` | `#A3261F` / `#FCECEA` | `#F2978F` / `#3A1D1B` |
| `--sev-major` | `#8A5A00` / `#FBF3DB` | `#E8B85C` / `#33270F` |
| `--sev-minor` | `#4B5563` / `#EEF0F3` | `#AAB2BD` / `#22262D` |
| `--state-pass` | `#2F6B3A` / `#EAF4EC` | `#7FC68D` / `#18301E` |

**Contrast rule:** every fg/bg pair must pass WCAG AA (4.5:1 body text, 3:1 for ≥18px). The values above are targets. **Verify each with axe in Playwright** (see Testing.md) and adjust the token, never the component.

**Theme:** follows `prefers-color-scheme` by default with a manual toggle (stored in a cookie). The theme is set once at the root layout. Sections never invert.

### 2.3 Typography

| Role | Font | Size / line-height | Weight | Tracking |
|---|---|---|---|---|
| Display (landing hero only) | Geist Sans | `text-4xl md:text-5xl` / 1.1 | 600 | `-0.02em` |
| H1 (page title) | Geist Sans | 24px / 32px | 600 | `-0.01em` |
| H2 (section) | Geist Sans | 18px / 28px | 600 | normal |
| H3 (card title) | Geist Sans | 15px / 22px | 600 | normal |
| Body (app) | Geist Sans | 14px / 22px | 400 | normal |
| Body (landing) | Geist Sans | 16px / 26px, `max-w-[65ch]` | 400 | normal |
| Small / meta | Geist Sans | 12px / 16px | 500 | normal |
| Code, diffs, SHAs, paths, numbers in tables | Geist Mono | 13px / 20px | 400 | normal |

Hierarchy comes from weight and color, not raw size. No oversized H1s inside the app.

### 2.4 Spacing, layout and breakpoints
- **Base unit 4px.** Use the Tailwind scale only; no arbitrary pixel values except tokens.
- **App container:** `max-w-6xl mx-auto px-4 md:px-6`. **Landing container:** `max-w-5xl`.
- **Vertical rhythm:** app sections `py-8`, landing sections `py-16 md:py-24`.
- **Breakpoints (Tailwind defaults):** `sm 640`, `md 768`, `lg 1024`, `xl 1280`.
  - `< 768px`: **single column always**. Tables become stacked rows, and side panels move below content.
  - `≥ 1024px`: run detail shows findings list + diff panel side by side (`grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]`).
- **Use CSS Grid for layout**, not flex percentage math.
- Full-height sections use `min-h-[100dvh]`, never `h-screen`.

### 2.5 Shape and elevation (shape lock)
**The rule, used everywhere:**

| Element | Radius |
|---|---|
| Cards, panels, dialogs, popovers | **8px** (`rounded-lg`) |
| Buttons, inputs, selects, `<kbd>` | **6px** (`rounded-md`) |
| Badges | **full pill**, small elements only |

- **Borders over shadows:** `1px solid var(--border)`.
- **Shadows:** only on popovers and dialogs: `0 4px 16px rgb(15 17 21 / 0.06)` (tinted, not black). No `shadow-md/lg/xl`.
- Use cards only when elevation means hierarchy. Otherwise group with `divide-y` or spacing.

### 2.6 Motion
- **Animate only** `transform` and `opacity`. Duration 150ms, easing `cubic-bezier(0.16, 1, 0.3, 1)`.
- **Allowed motion:**
  - button `:active` `scale(0.98)`
  - hover background tint on rows
  - dialog and popover fade+scale (shadcn default, kept at 150ms)
  - skeleton pulse
- **Not allowed:** scroll-triggered animations, marquees, parallax, `window.addEventListener('scroll')`, or GSAP.
- All motion is disabled under `prefers-reduced-motion: reduce`.
- No Motion library needed at dial 3; CSS transitions are enough.

### 2.7 Z-index scale
`header 40`, `popover 50`, `dialog 60`, `toast 70`. Defined once in `apps/web/src/lib/z-index.ts`, with no ad-hoc `z-*` values.

---

## 3. Component patterns

| Component | Spec |
|---|---|
| **App shell** | Top nav, height 56px, single line at `lg`: product mark + "MergeMind" wordmark, nav links (Repositories, Settings), user menu. Below `md`, the nav links move into a sheet. No sidebar. |
| **Button** | Variants: `primary` (accent bg, accent-fg text), `secondary` (surface bg + border), `ghost` (text only, visible focus ring), `danger` (critical fg on critical bg). Height 36px (app) / 40px (landing). Label ≤ 3 words, never wraps. |
| **Input / Select** | Label **above**, helper text below label, error text below input in `--sev-critical` fg. **No placeholder-as-label.** Focus ring 2px `--accent` with 2px offset. |
| **Severity badge** | Pill, `text-xs` 500 weight, uppercase, `tracking-[0.04em]`, sev fg on sev bg, with a Phosphor icon (`WarningOctagon` critical, `Warning` major, `Info` minor). Never color-only: the text label is always present. |
| **Gate result** | Inline row: icon + "Merge blocked: 1 critical finding" or "Passed". Uses `--sev-critical` / `--state-pass`. |
| **Repository list** | Table on `≥ md` (name, last review, open PRs, toggle), stacked rows on mobile. Plain rows with a `divide-y` bottom border only. No cards. |
| **PR row / run timeline** | Vertical list of runs: SHA (mono, 7 chars), trigger, mode, status, duration, counts by severity. Newest first. |
| **Finding card** | Bordered 8px panel: severity badge + pass name + `path:lines` (mono) on one line. Title (H3), body (markdown, sanitized), optional suggestion block. Actions: "Dismiss" (ghost), "View on GitHub" (link). |
| **Diff snippet** | Geist Mono 13px on `--surface-muted`, line numbers in `--text-muted`, flagged lines marked with a 2px left border in the severity color. Horizontal scroll inside the block only, never on the page. |
| **Policy viewer** | Read-only YAML in a code block + a validation result list (valid / errors with line numbers). |
| **Usage line** | Text, not a chart: "1.24M of 2M tokens used this month (62%)". Shows a warning badge at ≥ 80%. |
| **Empty state** | Icon (32px, muted) + one sentence + one action. Example: "No pull requests reviewed yet. Open a PR on an enabled repository." |
| **Loading state** | Skeletons that match the final layout shape. No generic spinners for page loads. |
| **Error state** | Inline panel with the `problem+json` `title`, `detail`, and `requestId` (mono, copyable) + "Retry". Toasts only for transient action results. |
| **Toast** | Bottom-right, auto-dismiss 5s, one at a time. |

---

## 4. Screens (information architecture)

| Route | Screen | Purpose |
|---|---|---|
| `/` | Landing | Explain and convert: install the GitHub App. Phase 6 ships a minimal page (headline, one line, Install on GitHub, Sign in); the full landing below arrives in Phase 7 with real screenshots |
| `/signin` | Sign in | "Continue with GitHub" |
| `/repos` | Repositories | Enabled repos, last review, toggle, reindex |
| `/repos/[repoId]` | Repository | Open PRs with latest run status, effective policy link |
| `/repos/[repoId]/pulls/[number]` | Pull request | Run timeline + gate result |
| `/runs/[runId]` | Review run | Findings list grouped by severity + diff snippet panel |
| `/settings` | Settings | Installations, provider allowlist (read-only for MVP), token budget, usage line |

---

## 5. Landing page (Taste-skill applies in full)

Landing dials: variance 3, motion 3, **density 4**.

| Section | Layout family | Content |
|---|---|---|
| **Hero** | Left-aligned split: copy left, real product screenshot right | Headline ≤ 2 lines (e.g. "Code review that never sleeps."), subtext ≤ 20 words, primary CTA **"Install on GitHub"**, secondary "See a sample review". No eyebrow, no tagline under CTAs, no logo strip. `pt-24` max. |
| **How a review runs** | Vertical stack, one large screenshot of a real PR with MergeMind comments | 3 short labeled steps written as verb-nouns ("Open a PR", "Get findings", "Merge with confidence"). No "Step 1/2/3" labels. |
| **What it checks** | Bento, **exactly 4 cells** (security, correctness, maintainability, CI failures), 2 cells with real visual variation (a diff snippet image, a tinted panel) | One sentence each. |
| **Runs on free tiers** | Full-width code block | The `docker compose up` + `ollama pull` commands. |
| **Footer** | Simple row | GitHub repo link, docs links. No version strings. |

- **CTA intent lock:** the install intent is labeled "Install on GitHub" everywhere (nav, hero, footer).
- **Images:** real screenshots of MergeMind once the UI exists. Until then, use labeled TODO slots (`<!-- TODO: hero screenshot 1600x1000 -->`). Never build a fake UI out of divs.

---

## 6. Copy rules

- **Zero em-dashes (`—`) and en-dashes (`–`)** in any UI string, alt text, or comment rendered to users. Use a period, comma, colon, or parentheses.
- No filler verbs: *elevate, seamless, unleash, next-gen, revolutionize, game-changer, delve*.
- No invented metrics. Numbers come from real data or are labeled "sample".
- Names in examples are realistic and locale-appropriate (e.g. "Ananya Iyer", "Rohan Mehta"), never "John Doe" / "Acme".
- No emojis in UI.
- Sentence case for headings and buttons.
- Error messages say what happened and what to do next.

---

## 7. Accessibility

- WCAG 2.2 AA minimum. Keyboard reachable everything, visible focus ring on every interactive element.
- Severity is never conveyed by color alone (icon + text).
- `aria-live="polite"` region for run status updates.
- Hit targets ≥ 40×40px on touch.
- Core Web Vitals targets: LCP < 2.5s, INP < 200ms, CLS < 0.1.

---

## 8. Pre-flight checklist (run before merging any UI PR)

- [ ] Correct rule set applied (landing = full Taste-skill; app = this file)
- [ ] Only design tokens used; no raw hex in components
- [ ] One accent (Cobalt); severity colors only for state
- [ ] Shape lock respected (8 / 6 / pill-badges)
- [ ] Zero em-dashes and en-dashes in visible strings
- [ ] Geist Sans + Geist Mono only; no serif, no Inter
- [ ] Phosphor icons only; no Lucide leftovers from shadcn
- [ ] Labels above inputs; no placeholder-as-label
- [ ] Button labels ≤ 3 words, no wrap at desktop, AA contrast
- [ ] Light **and** dark mode checked
- [ ] `< 768px` single-column verified; no horizontal page scroll
- [ ] Empty, loading, error states implemented
- [ ] `prefers-reduced-motion` disables transitions
- [ ] axe (Playwright) passes with zero serious/critical violations
- [ ] No dashboard patterns crept in (KPI tiles, charts)
