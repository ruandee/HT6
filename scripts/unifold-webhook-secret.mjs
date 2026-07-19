/**
 * Lists your Unifold webhook endpoints and prints each one's signing secret.
 *
 *   node scripts/unifold-webhook-secret.mjs
 *
 * Use this when you registered the webhook in the dashboard (rather than via
 * scripts/unifold-setup.mjs) and need the `whsec_…` value for UNIFOLD_WEBHOOK_SECRET.
 *
 * The secret is NOT one-shot: `GET /v1/webhook_endpoints/{id}/secret` is documented as "the only
 * way to retrieve the secret after creation", so you can re-read it whenever you need it. You do
 * not have to delete and re-create an endpoint just because you lost the value.
 *
 * Reads UNIFOLD_SECRET_KEY from .env (gitignored). Prints secrets to your terminal by design —
 * that is the whole point — so don't run it on a shared screen or paste the output anywhere.
 */
import { requireSecretKey } from './unifold-env.mjs';

const API_BASE = process.env.UNIFOLD_API_BASE ?? 'https://api.unifold.io/v1';
const secretKey = requireSecretKey();

async function call(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { authorization: `Bearer ${secretKey}`, accept: 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

const listed = await call('/webhook_endpoints');
const endpoints = Array.isArray(listed) ? listed : (listed?.data ?? listed?.endpoints ?? []);

if (!endpoints.length) {
  console.log(
    '\nNo webhook endpoints registered yet. Create one in the dashboard, or run:\n' +
      '  node scripts/unifold-setup.mjs --webhook-url https://<your-cloud-run>.run.app\n',
  );
  process.exit(0);
}

console.log(`\n${endpoints.length} webhook endpoint(s):\n`);
for (const ep of endpoints) {
  console.log(`  ${ep.id}`);
  console.log(`  url:    ${ep.url}`);
  if (ep.enabled_events) console.log(`  events: ${ep.enabled_events.length} subscribed`);
  try {
    const { secret } = await call(`/webhook_endpoints/${ep.id}/secret`);
    console.log(`  UNIFOLD_WEBHOOK_SECRET=${secret}`);
  } catch (e) {
    console.log(`  secret: could not retrieve — ${e.message}`);
  }
  console.log('');
}

console.log(
  'Paste the UNIFOLD_WEBHOOK_SECRET line for the endpoint whose url matches your deployment\n' +
    'into .env (gitignored). If an endpoint points at localhost or an old URL, delete it in the\n' +
    'dashboard — stale endpoints keep receiving retries and muddy the event log.\n',
);
