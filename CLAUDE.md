# CLAUDE.md

The project handbook lives in **AGENTS.md** and is imported here:

@AGENTS.md

## Claude Code specifics
- **Start every session by reading [memory.md](memory.md).** It holds the current phase, the last session's work, and next steps.
- **End every session by updating [memory.md](memory.md)**: add a dated entry to the session log and refresh the "Current state" block. Do this before your final message, even if the session was short.
- When you make a non-trivial technical choice, append an ADR to [Decisions.md](Decisions.md) using its template.
- Skills for this repo are in `.claude/skills/` (junctions to `.agents/skills/`):
  - `design-taste-frontend`: use for the landing page.
  - `minimalist-ui`: reference for app screens.
  - Design.md overrides both.
- Use the plan mode for any change that touches more than one workspace or alters Architecture.md.
