// Free-tier providers limit tokens per minute (Groq: 8,000 for gpt-oss-120b). The benchmark
// paces itself with a rolling one-minute window instead of tripping 429s and the circuit
// breaker, which would fail fixtures for reasons unrelated to review quality (ADR-032).

const WINDOW_MS = 60_000;

export class TokenWindow {
  private readonly spent: { at: number; tokens: number }[] = [];

  constructor(
    private readonly limitPerMinute: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  record(tokens: number): void {
    this.spent.push({ at: this.now(), tokens });
  }

  /** How long to wait before spending `estimate` tokens keeps the window under the limit. */
  waitMsFor(estimate: number): number {
    const now = this.now();
    while (this.spent.length > 0 && (this.spent[0]?.at ?? now) <= now - WINDOW_MS) {
      this.spent.shift();
    }
    let total = this.spent.reduce((sum, entry) => sum + entry.tokens, 0);
    if (total + estimate <= this.limitPerMinute) {
      return 0;
    }
    // Wait until enough of the oldest spending ages out of the window.
    for (const entry of this.spent) {
      total -= entry.tokens;
      if (total + estimate <= this.limitPerMinute) {
        return Math.max(0, entry.at + WINDOW_MS - now);
      }
    }
    return Math.max(0, (this.spent.at(-1)?.at ?? now) + WINDOW_MS - now);
  }
}
