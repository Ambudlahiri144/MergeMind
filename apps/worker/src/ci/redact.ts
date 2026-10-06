// Log lines leave the machine (LLM provider, PR comment), so obvious credentials are masked
// first. GitHub already masks registered secrets as ***; this catches the ones it doesn't know.
const REDACTED = '[redacted]';

const TOKEN_PATTERNS: readonly RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\b[rs]k_(?:live|test)_[A-Za-z0-9]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];

const KEYED_SECRET =
  /\b((?:password|passwd|secret|api[_-]?key|access[_-]?token|token)\s*[=:]\s*)["']?[^\s"']{4,}/gi;
const AUTH_HEADER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]{12,}=*/g;
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

export function redactLogLine(line: string): string {
  if (PRIVATE_KEY.test(line)) {
    return REDACTED;
  }
  let redacted = line;
  for (const pattern of TOKEN_PATTERNS) {
    redacted = redacted.replace(pattern, REDACTED);
  }
  return redacted.replace(KEYED_SECRET, `$1${REDACTED}`).replace(AUTH_HEADER, `$1 ${REDACTED}`);
}
