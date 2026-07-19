/**
 * Shared .env reader + secret-key check for the Unifold setup scripts.
 *
 * Exists because the naive version of this (`split('=')[1].trim()`) silently swallowed the inline
 * comment in `UNIFOLD_SECRET_KEY=sk_live_…   # SECRET` — the exact format .env.example ships — and
 * sent the comment to the API as part of the key. That surfaces as a baffling
 * `401 invalid_secret_key` on a key you just copied correctly. Parsing rules here match Node's own
 * `--env-file`: strip an unquoted trailing `# comment`, then strip surrounding quotes.
 */
import { readFileSync } from 'node:fs';

/** Read one key from the repo-root .env. Returns undefined if absent or unreadable. */
export function fromDotEnv(key) {
  let raw;
  try {
    raw = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  } catch {
    return undefined;
  }
  // .trim() on the line also handles CRLF, which Windows checkouts produce.
  const line = raw.split('\n').find((l) => l.trim().startsWith(`${key}=`));
  if (!line) return undefined;
  let v = line.slice(line.indexOf('=') + 1).trim();
  // Inline comments apply to UNQUOTED values only — a quoted value may legitimately contain '#'.
  // Requiring whitespace before '#' also protects values where '#' is part of the token itself.
  if (!/^["']/.test(v)) v = v.replace(/\s+#.*$/, '').trim();
  return v.replace(/^["']|["']$/g, '') || undefined;
}

/**
 * Resolve the Unifold secret key and fail loudly on the mistakes that produce confusing API
 * errors rather than clear ones.
 */
export function requireSecretKey() {
  const key = process.env.UNIFOLD_SECRET_KEY || fromDotEnv('UNIFOLD_SECRET_KEY');
  if (!key) {
    die('No UNIFOLD_SECRET_KEY in the environment or .env. Add it to .env first.');
  }
  if (/\s/.test(key) || key.includes('#')) {
    // Belt and braces: if this ever fires, the parser above missed something new.
    die(
      `UNIFOLD_SECRET_KEY contains whitespace or '#', so it is not a bare key.\n` +
        `  Check .env for a trailing comment on that line — the value must be the key alone.`,
    );
  }
  if (!key.startsWith('sk_')) {
    die(
      `UNIFOLD_SECRET_KEY must start with "sk_" (got "${key.slice(0, 6)}…").\n` +
        `  Publishable "pk_" keys cannot create treasury accounts or webhooks.`,
    );
  }
  if (key.startsWith('sk_test_')) {
    console.warn(
      '\n⚠  That is a TEST key. Unifold advise against testnet — the providers behind it are not\n' +
        '   well maintained, and Checkout is tied to mainnet. Use sk_live_ with small amounts.\n',
    );
  }
  return key;
}

export function die(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}
