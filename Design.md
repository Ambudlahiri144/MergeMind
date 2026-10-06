# MergeMind: Design System

> **Style: Neo-brutalism** (ADR-036): thick ink borders, hard zero-blur offset shadows, flat saturated fills, bold grotesk type on a strict grid. Sources, in order of precedence:
> 1. **This file.** Where it and a skill disagree, this file wins.
> 2. **neobrutalist-web-designer** (`erichowens/some_claude_skills`, pinned in `skills-lock.json`): the style itself (borders, shadows, palette rules, anti-patterns).
> 3. **Taste-skill** (`.agents/skills/design-taste-frontend/SKILL.md`, MIT): layout discipline, hero and copy rules, its pre-flight check.
> 4. **UI/UX Pro Max** (`nextlevelbuilder/ui-ux-pro-max-skill`): UX and accessibility checklists. Its palettes, fonts and motion are not used.
>
> Component styling is adapted from **neobrutalism.dev** and **RetroUI** (both MIT, see `apps/web/THIRD_PARTY_NOTICES.md`). Their classes are ported into our own components. Their dependencies (Base UI, Lucide, shadcn CLI) are not installed. `minimalist-ui` no longer applies.

---

## 0. Scope: loud landing, disciplined app

| Surface | Treatment |
|---|---|
| **Landing page** (`/`) | Full neo-brutalism: flat colour bands, oversized headlines, marker-highlighted words, coloured bento cells, an ink terminal block. |
| **App screens** (`/repos`, PR, run, settings, sign-in) | The same borders, shadows, type and tokens on a strict grid, with calm fills. At most one loud element per screen: the gate banner or the active nav tab. |

**Why the split:** disciplined, grid-based brutalism tests well for usability, while chaotic anti-design hurts task success on information-heavy pages. Findings and diffs are information-heavy.

**Design read:** *a developer tool that looks like it was built by engineers who enjoy their tools: confident, legible, a little loud, never chaotic.*

**Explicitly not a dashboard.** No KPI tile grids, no charts, no "analytics" page. Numbers appear inline in text or small tables where they answer a question.

---

## 1. Dials

| Dial | App | Landing | Reason |
|---|---|---|---|
| `DESIGN_VARIANCE` | **3** | **5** | The app scans predictably; the landing may use colour blocks and a rotated sticker. |
| `MOTION_INTENSITY` | **3** | **3** | Physical press feedback only. No scroll animation. |
| `VISUAL_DENSITY` | **6** | **4** | Findings lists need moderate density; the landing breathes. |

---

## 2. Foundations

### 2.1 Design system
- **Owned components** in `apps/web/src/components/ui`, written in the shadcn way (`cva` variants + `cn`). The dialog is the native `<dialog>`; no primitive library.
- **Tailwind v4** with `@tailwindcss/postcss`. Tokens are CSS variables in `apps/web/src/app/globals.css`, exposed through `@theme inline`.
- **Icons:** `@phosphor-icons/react`, **Bold** weight (it matches the heavy strokes), sizes 16/18/20/28. No Lucide, no hand-drawn SVG icons.
- **Fonts:** Space Grotesk (400/500/700) and JetBrains Mono (400/500) through `next/font/google`, self-hosted at build time (no runtime request to Google). No serif, no Inter.

### 2.2 Colour tokens

Black ink and off-white, plus one main colour (**lemon**) and three flat secondaries. No gradients, no blur, no glow.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#FDF8F5` | `#17171B` | page canvas |
| `--surface` | `#FFFFFF` | `#232329` | panels, cards, inputs |
| `--surface-muted` | `#F4EEE7` | `#2D2D34` | code blocks, hover rows |
| `--border` (the **ink**) | `#111111` | `#E6E0D4` | every border **and every hard shadow**. Dark mode inverts it to cream so outlines stay visible. |
| `--text` | `#111111` | `#F2EDE4` | primary text, focus outline |
| `--text-muted` | `#46464E` | `#C4BEB4` | secondary text, metadata |
| `--main` / `--main-strong` | `#FFE17C` / `#FFD23F` | same | primary buttons, active nav, markers, hero and CTA bands |
| `--info` | `#A5E3FF` | same | flat secondary fill (landing) |
| `--lavender` | `#D7D2FF` | same | flat secondary fill (landing) |
| `--on-fill` | `#111111` | same | text on any flat fill, in both themes |

**Severity colours are semantic state, not decoration.** The **fills** (`--sev-*-bg`) are used for badges, the gate banner and the flagged-line gutter, always with ink text, an icon and a label. The **fg** values are for severity text on a surface.

| Severity | Fill (both themes) | Text on surface (light / dark) |
|---|---|---|
| critical | `#FF8A80` | `#B3261E` / `#FF9A90` |
| major | `#FFB870` | `#8A4B00` / `#FFBE7A` |
| minor | `#E2DEFF` | `#4A4560` / `#CFC9FF` |
| pass | `#8EE6B2` | `#1E6B3A` / `#8EE6B2` |

**Band scopes:** flat colour bands keep light-theme ink inside them in both themes (`scope-fill`); ink bands such as the footer and terminal use `scope-ink`. Both re-point the tokens, so borders, shadows and focus inside follow automatically.

**Contrast rule:** every pair passes WCAG AA, most at 6:1 or better (computed, then verified with axe in Playwright). Fix a failing pair in the token, never in the component. The one raw colour outside `globals.css` is the dialog backdrop (`black/60`).

**Theme:** follows `prefers-color-scheme`, with a cookie toggle set at the root layout.

### 2.3 Typography

| Role | Font | Size / line-height | Weight | Tracking |
|---|---|---|---|---|
| Display (landing hero) | Space Grotesk | `text-5xl md:text-6xl lg:text-[64px]` / 0.95 | 700 | `-0.04em` |
| Landing section title | Space Grotesk | `text-4xl md:text-5xl` / 1.05 | 700 | `-0.03em` |
| H1 (app page title) | Space Grotesk | 28px / 34px | 700 | `-0.02em` |
| H2 (app section) | Space Grotesk | 18px / 28px | 700 | normal |
| H3 (card title) | Space Grotesk | 17px / 24px | 700 | normal |
| Body (app) | Space Grotesk | 15px / 24px | 500 | normal |
| Body (landing) | Space Grotesk | 16-18px / 26-28px, `max-w-[60ch]` | 500 | normal |
| Code, diffs, SHAs, paths, meta labels | JetBrains Mono | 13px / 20px (labels 12px, uppercase for badges) | 400-500 | `0.04em` on badges |

### 2.4 Spacing, layout and breakpoints
- **Base unit 4px.** Tailwind scale only; no arbitrary pixel values except tokens and the type sizes above.
- **Container:** `max-w-6xl mx-auto px-4 md:px-6` on every surface.
- **Vertical rhythm:** app `py-10` with `mb-8` under the page header rule; landing sections `py-20 md:py-28`, each ending on a 2px ink rule.
- **Breakpoints (Tailwind defaults):** `sm 640`, `md 768`, `lg 1024`, `xl 1280`.
  - `< 768px`: **single column always**; tables become stacked rows.
  - `≥ 1024px`: the run page shows findings + code panel side by side.
- **CSS Grid** with `grid-cols-[minmax(0,1fr)]` and `min-w-0` children, so long code never widens the page. `min-h-[100dvh]`, never `h-screen`.

### 2.5 Shape and depth (shape lock)

| Element | Rule |
|---|---|
| Radius | **5px** everywhere (`rounded-base`); badges are full pills |
| Borders | **2px ink** in the app; **3px** for landing frames and dialogs |
| Shadows | `shadow-hard-sm` 2px, `shadow-hard` 4px, `shadow-hard-lg` 8px, all `0 blur` in the ink. `shadow-hard-main` (lemon) marks the selected finding. |

- Panels, cards, lists and code windows sit on `shadow-hard`; the landing screenshots and dialogs on `shadow-hard-lg`.
- Lists are **one** bordered panel with 2px dividers, never a card per row.
- No soft shadows, no transparency (except the dialog backdrop), no radius above 5px.

### 2.6 Motion
- **The press** (`press` utility): a control sits on `shadow-hard`. On hover it moves 2px onto a 2px shadow; on `:active` it moves 4px and the shadow disappears. Only `transform` and `box-shadow` change, in 100ms with `cubic-bezier(0.16, 1, 0.3, 1)`.
- Allowed otherwise: hover background tints, the focus-shadow on inputs, the skeleton pulse.
- **Not allowed:** scroll-triggered animation, marquees, parallax, GSAP.
- All transitions are instant under `prefers-reduced-motion: reduce`.

### 2.7 Z-index scale
`header 40`, `popover 50`, `dialog 60`, `toast 70`. Defined once in `apps/web/src/lib/z-index.ts`, with no ad-hoc `z-*` values.

---

## 3. Component patterns

| Component | Spec |
|---|---|
| **App shell** | 56px opaque white bar with a 2px ink bottom rule. Wordmark is a lemon icon tile + "MergeMind" in bold. The active nav link is a lemon tab with a border and `shadow-hard-sm`. Below `md`, links move into a bordered disclosure panel. No sidebar. |
| **Button** | 2px ink border, bold label, `press`. Variants: `primary` (lemon), `secondary` (surface), `ghost` (border on hover only), `danger` (critical fill), `ink` (ink fill, lemon text; the primary action on a lemon band). Height 36px app / 40px touch. Label ≤ 3 words, never wraps. |
| **Input / Textarea** | `FIELD` in `ui/field.ts`: 2px ink border, lifts onto `shadow-hard` on focus. Label **above** in bold; helper text below the label; error text in critical fg. No placeholder-as-label. |
| **Severity badge** | Pill sticker: severity fill, 2px ink border, JetBrains Mono uppercase label, Phosphor Bold icon (`WarningOctagon`, `Warning`, `Info`). |
| **Gate result** | Bordered banner on `shadow-hard-sm`: critical fill "Merge blocked: 1 critical finding", pass fill "Passed", plain surface for "No verdict" / "In progress". |
| **Repository list / run timeline** | One bordered panel with 2px dividers on `shadow-hard`. SHAs mono 7 chars. Newest first. |
| **Finding card** | White panel, 2px ink border, `shadow-hard` (`shadow-hard-main` when selected). Badge + pass + underlined mono `path:lines`; bold title; body; bordered suggestion block; "Dismiss" (ghost) and "View on GitHub" (underlined link). |
| **Diff snippet** | A code window: ink title bar (path and SHA), JetBrains Mono 13px, a 2px rule between line numbers and code, flagged lines with a severity-filled number gutter. Scrolls inside the block only. |
| **Policy viewer** | Bordered YAML block + "Valid" or the error list. |
| **Usage line** | Text, not a chart: "1.24M of 2M tokens used this month (62%)", with a major-fill pill at ≥ 80%. |
| **Empty state** | Bordered panel on `shadow-hard`: a lemon icon tile + one sentence + one action. |
| **Loading state** | Layout-shaped skeletons inside the same bordered panels. |
| **Error state** | Bordered panel with a critical icon tile, the `problem+json` `title` and `detail`, and a copyable `requestId`, plus "Retry". |
| **Dialog** | Native `<dialog>`, 3px border, `shadow-hard-lg`, backdrop `black/60`. |

---

## 4. Screens (information architecture)

| Route | Screen | Purpose |
|---|---|---|
| `/` | Landing | Explain and convert: install the GitHub App |
| `/signin` | Sign in | "Continue with GitHub" in a bordered card on `shadow-hard-lg` |
| `/repos` | Repositories | Enabled repos, last review, toggle, reindex |
| `/repos/[repoId]` | Repository | Open PRs with latest run status, effective policy |
| `/repos/[repoId]/pulls/[number]` | Pull request | Gate banner, rerun, run timeline |
| `/runs/[runId]` | Review run | Findings grouped by severity + the code window |
| `/settings` | Settings | Installations, provider allowlist (read-only), token budget, usage line |

---

## 5. Landing page

| Section | Treatment | Content |
|---|---|---|
| **Hero** | Lemon band (`scope-fill`). Copy left, real screenshot right in a 3px frame on `shadow-hard-lg`, a rotated "with sample data" sticker as the caption. | Headline ≤ 2 lines ("Code review that never sleeps."), subtext ≤ 20 words, CTAs **"Install on GitHub"** (ink) and "See a sample review" (secondary). No eyebrow, no logo strip. |
| **How a review runs** | Title with a lemon marker word; 3 bordered cards with a lemon icon tile and a large mono numeral (`01`-`03`); the real GitHub review screenshot, framed. | Verb-noun steps: "Open a PR", "Get findings", "Merge with confidence". |
| **What it checks** | Bento, **exactly 4 cells**, each a different flat fill: security (white, with the finding screenshot), correctness (cyan), maintainability (lavender), CI failures (lemon, with a real CI comment excerpt). | One sentence each. |
| **Runs on free tiers** | Ink terminal window (`scope-ink`) with a "Terminal" title bar. | The `docker compose up` + `ollama pull` commands. |
| **Closing CTA** | Lemon band. | One line + "Install on GitHub" (ink). |
| **Footer** | Ink band (`scope-ink`). | Repo and public docs links. No version strings. |

- **CTA intent lock:** "Install on GitHub" everywhere (nav, hero, closing CTA).
- **Images:** real screenshots only (`npm run screenshots -w @mergemind/web`), never a fake UI built from divs.

---

## 6. Copy rules

- **Zero em-dashes (`—`) and en-dashes (`–`)** in any UI string, alt text, or comment rendered to users. Use a period, comma, colon, or parentheses.
- No filler verbs: *elevate, seamless, unleash, next-gen, revolutionize, game-changer, delve*.
- No invented metrics. Numbers come from real data or are labeled "sample".
- Names in examples are realistic and locale-appropriate (e.g. "Ananya Iyer", "Rohan Mehta"), never "John Doe" / "Acme".
- No emojis in UI.
- Sentence case for headings and buttons (no all-caps headlines; uppercase is for mono badge labels only).
- Error messages say what happened and what to do next.

---

## 7. Accessibility

- WCAG 2.2 AA minimum. Keyboard reachable everything; a 3px focus outline in the text colour with a 2px offset, visible on every fill.
- Severity is never conveyed by colour alone (icon + text).
- `aria-live="polite"` region for action results and run status.
- Hit targets ≥ 40×40px on touch.
- Core Web Vitals targets: LCP < 2.5s, INP < 200ms, CLS < 0.1. Hard shadows and flat fills are cheap to paint; keep it that way (no filters, no backdrop blur).

---

## 8. Pre-flight checklist (run before merging any UI PR)

- [ ] Right treatment for the surface (loud landing, disciplined app)
- [ ] Only design tokens used; no raw hex in components
- [ ] Borders 2px (3px on landing frames and dialogs), radius 5px, pills only for badges
- [ ] Every shadow is a hard `shadow-hard*`; no blur, no transparency
- [ ] Flat colour bands use `scope-fill`, ink bands `scope-ink`
- [ ] Severity fills only for state, always with icon + label
- [ ] Zero em-dashes and en-dashes in visible strings
- [ ] Space Grotesk + JetBrains Mono only; Phosphor icons only
- [ ] Labels above inputs; no placeholder-as-label
- [ ] Button labels ≤ 3 words, no wrap at desktop
- [ ] Light **and** dark mode checked
- [ ] `< 768px` single column; no horizontal page scroll
- [ ] Empty, loading, error states implemented
- [ ] `prefers-reduced-motion` makes transitions instant
- [ ] axe (Playwright) passes with zero serious/critical violations
- [ ] No dashboard patterns crept in (KPI tiles, charts)
