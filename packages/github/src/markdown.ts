import type { GateConclusion, Severity } from '@mergemind/shared';

/** GitHub caps check-run summaries at 65,535 characters. */
const MAX_CHECK_SUMMARY_LENGTH = 65_000;
const MAX_SUMMARY_BODY_PREVIEW = 300;
const SHORT_SHA_LENGTH = 7;

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  major: 'Major',
  minor: 'Minor',
};

const RUN_MARKER_PATTERN = /<!-- mergemind:run=([a-f0-9]{24}) -->/;
const FINGERPRINT_MARKER_PATTERN = /<!-- mergemind:fp=([a-f0-9]{64}) -->/;

/** Hidden marker in the review body; finding it again prevents a duplicate review (ADR-018). */
export function runMarker(runId: string): string {
  return `<!-- mergemind:run=${runId} -->`;
}

export function fingerprintMarker(fingerprint: string): string {
  return `<!-- mergemind:fp=${fingerprint} -->`;
}

export function extractRunId(body: string | null | undefined): string | null {
  return RUN_MARKER_PATTERN.exec(body ?? '')?.[1] ?? null;
}

export function extractFingerprint(body: string | null | undefined): string | null {
  return FINGERPRINT_MARKER_PATTERN.exec(body ?? '')?.[1] ?? null;
}

/**
 * Model text is untrusted: strip HTML comments (so it can never forge our markers) and break
 * @mentions (so a review never pings people or teams).
 */
export function sanitizeModelText(text: string): string {
  return text.replace(/<!--|-->/g, '').replace(/(^|[^\w`])@([A-Za-z0-9][\w-]*)/g, '$1@​$2');
}

/** A fence longer than any backtick run inside the code, so model output can't close it early. */
function codeFence(code: string): string {
  const longestRun = Math.max(2, ...(code.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longestRun + 1);
  return `${fence}\n${code}\n${fence}`;
}

export type PublishedFinding = {
  severity: Severity;
  title: string;
  body: string;
  path: string;
  lineStart: number;
  lineEnd: number;
  suggestion: string | null;
  fingerprint: string;
};

export function renderInlineComment(finding: PublishedFinding): string {
  const parts = [
    `**${SEVERITY_LABEL[finding.severity]}:** ${sanitizeModelText(finding.title)}`,
    sanitizeModelText(finding.body),
  ];
  if (finding.suggestion !== null) {
    parts.push(`**Suggested fix**\n\n${codeFence(finding.suggestion)}`);
  }
  parts.push(fingerprintMarker(finding.fingerprint));
  return parts.join('\n\n');
}

export type SummaryCounts = {
  critical: number;
  major: number;
  minor: number;
  suppressed: number;
  filtered: number;
  duplicate: number;
  /** Cross-pass restatements folded into another finding (optional for older runs). */
  merged?: number;
};

export type BodyFinding = PublishedFinding & {
  /** Why it is in the body rather than inline. */
  placementReason: 'minor' | 'outside_diff' | 'overflow';
};

export type ReviewBodyInput = {
  runId: string;
  headSha: string;
  counts: SummaryCounts;
  inlineCount: number;
  bodyFindings: readonly BodyFinding[];
  notes: readonly string[];
};

function location(finding: Pick<PublishedFinding, 'path' | 'lineStart' | 'lineEnd'>): string {
  const lines =
    finding.lineStart === finding.lineEnd
      ? `L${finding.lineStart}`
      : `L${finding.lineStart}-L${finding.lineEnd}`;
  return `\`${finding.path}:${lines}\``;
}

function countsLine(counts: SummaryCounts): string {
  return (['critical', 'major', 'minor'] as const)
    .map((severity) => {
      const label = `${counts[severity]} ${severity}`;
      return counts[severity] > 0 && severity !== 'minor' ? `**${label}**` : label;
    })
    .join(' · ');
}

function preview(text: string): string {
  const clean = sanitizeModelText(text).replace(/\s+/g, ' ').trim();
  return clean.length > MAX_SUMMARY_BODY_PREVIEW
    ? `${clean.slice(0, MAX_SUMMARY_BODY_PREVIEW)}...`
    : clean;
}

const PLACEMENT_HEADINGS: Record<BodyFinding['placementReason'], string> = {
  minor: 'Nits',
  outside_diff: 'Outside the changed lines',
  overflow: 'More findings',
};

/** The single review's body (PRD F3): counts, notes, and findings that are not inline. */
export function renderReviewBody(input: ReviewBodyInput): string {
  const sections = [`### MergeMind review\n\n${countsLine(input.counts)}`];
  if (input.inlineCount > 0) {
    sections.push(
      `${input.inlineCount} inline comment${input.inlineCount === 1 ? '' : 's'} below.`,
    );
  }
  if (input.notes.length > 0) {
    sections.push(`#### Notes\n\n${input.notes.map((note) => `- ${note}`).join('\n')}`);
  }
  for (const reason of ['overflow', 'outside_diff', 'minor'] as const) {
    const group = input.bodyFindings.filter((finding) => finding.placementReason === reason);
    if (group.length > 0) {
      const items = group.map(
        (finding) =>
          `- **${SEVERITY_LABEL[finding.severity]}** ${location(finding)} ${sanitizeModelText(finding.title)}: ${preview(finding.body)}`,
      );
      sections.push(`#### ${PLACEMENT_HEADINGS[reason]}\n\n${items.join('\n')}`);
    }
  }
  const { filtered, suppressed, duplicate, merged = 0 } = input.counts;
  const mergedNote = merged > 0 ? ` · ${merged} duplicate${merged === 1 ? '' : 's'} merged` : '';
  sections.push(
    `<sub>Reviewed \`${input.headSha.slice(0, SHORT_SHA_LENGTH)}\` · ${filtered} below the confidence threshold · ${suppressed} suppressed · ${duplicate} already reported${mergedNote}</sub>`,
  );
  sections.push(runMarker(input.runId));
  return sections.join('\n\n');
}

export type CheckOutputInput = {
  conclusion: GateConclusion;
  counts: SummaryCounts;
  notes: readonly string[];
  /** Overrides the default title, e.g. for budget or size skips. */
  headline?: string;
};

function defaultTitle(conclusion: GateConclusion, counts: SummaryCounts): string {
  if (conclusion === 'failure') {
    return `Blocking findings: ${counts.critical} critical, ${counts.major} major`;
  }
  if (conclusion === 'success') {
    const total = counts.critical + counts.major + counts.minor;
    return total === 0
      ? 'No issues found'
      : `${total} non-blocking finding${total === 1 ? '' : 's'}`;
  }
  return 'Review not completed';
}

/** `output` for the `mergemind/review` check run (PRD F4). */
export function renderCheckOutput(input: CheckOutputInput): { title: string; summary: string } {
  const lines = [countsLine(input.counts), ...input.notes.map((note) => `- ${note}`)];
  const summary = lines.join('\n\n');
  return {
    title: input.headline ?? defaultTitle(input.conclusion, input.counts),
    summary:
      summary.length > MAX_CHECK_SUMMARY_LENGTH
        ? `${summary.slice(0, MAX_CHECK_SUMMARY_LENGTH)}\n\n(truncated)`
        : summary,
  };
}

/** A review body that only carries a notice (summary-only mode for oversized PRs). */
export function renderNoticeBody(
  runId: string,
  notice: string,
  notes: readonly string[] = [],
): string {
  const sections = [`### MergeMind review\n\n${notice}`];
  if (notes.length > 0) {
    sections.push(notes.map((note) => `- ${note}`).join('\n'));
  }
  sections.push(runMarker(runId));
  return sections.join('\n\n');
}

const RESOLVED_MARKER_PATTERN = /<!-- mergemind:resolved=([a-f0-9]{64}) -->/;

/** Marker on a "resolved" reply; finding it again prevents a second reply (ADR-023). */
export function resolvedMarker(fingerprint: string): string {
  return `<!-- mergemind:resolved=${fingerprint} -->`;
}

export function extractResolvedFingerprint(body: string | null | undefined): string | null {
  return RESOLVED_MARKER_PATTERN.exec(body ?? '')?.[1] ?? null;
}

/** Reply posted on a finding's comment when a later push fixed it. */
export function renderResolvedReply(fingerprint: string, headSha: string): string {
  return `Resolved in \`${headSha.slice(0, SHORT_SHA_LENGTH)}\`: this code changed and MergeMind no longer reports the issue.\n\n${resolvedMarker(fingerprint)}`;
}
