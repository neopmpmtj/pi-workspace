/**
 * Secret redaction for prompt dumps.
 *
 * The instruction surface contains no credentials by design (secrets live in
 * ~/.pi/agent/.env and are referenced only as $VAR). This pass is defence in
 * depth for the case where a secret has leaked into a prompt file, and it is
 * what makes a dump safe to paste into a chat or an issue.
 *
 * Redaction applies to DISPLAY output only. Hashing and baseline comparison
 * always run on the raw text, so redaction can never mask drift.
 */

const PATTERNS = [
  { kind: "openai-style-key", re: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { kind: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g },
  { kind: "github-token", re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g },
  { kind: "github-pat", re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { kind: "aws-access-key", re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { kind: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { kind: "bearer-token", re: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/g },
  {
    kind: "assigned-secret",
    re: /\b([A-Za-z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|HASH|CREDENTIAL)[A-Za-z0-9_]*)\s*([=:])\s*["']?([A-Za-z0-9+/._-]{20,})["']?/g,
    replace: (_m, name, sep) => `${name}${sep}«REDACTED:value»`,
  },
];

export function redact(text) {
  let output = String(text);
  const counts = {};

  for (const { kind, re, replace } of PATTERNS) {
    output = output.replace(re, (...args) => {
      counts[kind] = (counts[kind] ?? 0) + 1;
      if (replace) return replace(...args);
      return `«REDACTED:${kind}»`;
    });
  }

  return { text: output, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
}
