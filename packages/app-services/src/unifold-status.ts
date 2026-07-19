/**
 * LIVE Unifold integration status — read-only proof that the payment rail is real.
 *
 * Every field on this page comes from an authenticated call to api.unifold.io made at request
 * time. Nothing is cached, mocked, or hardcoded: revoke the key and the page fails immediately.
 * That is the point — it is evidence, not a screenshot.
 *
 * DELIBERATELY INDEPENDENT OF `PAYMENT_GATEWAY`. Whether the integration is live and whether every
 * demo click spends real money are separate questions. These endpoints need only the secret key,
 * so the demo can run on StubGateway (unfailable, free) while this page proves the real rail is
 * configured and reachable.
 *
 * READ-ONLY BY CONSTRUCTION: only GETs are issued. Nothing here creates, moves, or refunds money.
 */

const TIMEOUT_MS = 8_000;

export interface StatusConfig {
  apiBase: string;
  secretKey: string;
  /** Which gateway the app is actually serving buys with — reported, not used to fetch. */
  gateway: 'stub' | 'unifold';
  treasuryId: string;
  webhookSecretConfigured: boolean;
}

interface Section<T> {
  ok: boolean;
  error?: string;
  data?: T;
}

export interface UnifoldStatus {
  checkedAt: string;
  apiBase: string;
  /** Key prefix only — never the key. `sk_live_` vs `sk_test_` is itself meaningful. */
  keyPrefix: string;
  liveMode: boolean;
  gateway: 'stub' | 'unifold';
  webhookSecretConfigured: boolean;
  authenticated: boolean;
  treasuries: Section<Array<Record<string, unknown>>>;
  webhooks: Section<Array<Record<string, unknown>>>;
  paymentIntents: Section<Array<Record<string, unknown>>>;
  outboundTransfers: Section<Array<Record<string, unknown>>>;
}

/** Unwrap the API's `{data:[...]}` / bare-array / `{...}` shapes into a plain array. */
function asList(body: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(body)) return body as Array<Record<string, unknown>>;
  const obj = body as Record<string, unknown> | null;
  for (const key of ['data', 'accounts', 'endpoints', 'payment_intents', 'outbound_transfers']) {
    const v = obj?.[key];
    if (Array.isArray(v)) return v as Array<Record<string, unknown>>;
  }
  return obj && typeof obj === 'object' ? [obj as Record<string, unknown>] : [];
}

export async function fetchUnifoldStatus(cfg: StatusConfig): Promise<UnifoldStatus> {
  const base = cfg.apiBase.replace(/\/+$/, '');

  /** Each section fails independently — one dead endpoint must not blank the whole page. */
  async function get(path: string): Promise<Section<Array<Record<string, unknown>>>> {
    if (!cfg.secretKey) return { ok: false, error: 'no secret key configured' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${base}${path}`, {
        headers: { authorization: `Bearer ${cfg.secretKey}`, accept: 'application/json' },
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 160)}` };
      return { ok: true, data: asList(text ? JSON.parse(text) : []) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      clearTimeout(timer);
    }
  }

  const [treasuries, webhooks, paymentIntents, outboundTransfers] = await Promise.all([
    get('/treasury/accounts'),
    get('/webhook_endpoints'),
    get('/payment_intents?limit=10'),
    get('/treasury/outbound_transfers?limit=10'),
  ]);

  return {
    checkedAt: new Date().toISOString(),
    apiBase: base,
    keyPrefix: cfg.secretKey ? `${cfg.secretKey.slice(0, 8)}…` : '(unset)',
    liveMode: cfg.secretKey.startsWith('sk_live_'),
    gateway: cfg.gateway,
    webhookSecretConfigured: cfg.webhookSecretConfigured,
    // Treasury listing is the auth canary: it needs a valid secret key and nothing else.
    authenticated: treasuries.ok,
    treasuries,
    webhooks,
    paymentIntents,
    outboundTransfers,
  };
}

// ---------------------------------------------------------------------------
// HTML rendering (self-contained; no external assets, no scripts)
// ---------------------------------------------------------------------------

function esc(s: unknown): string {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

function usdc(base: unknown): string {
  const n = Number(base);
  return Number.isFinite(n) ? `$${(n / 1e6).toFixed(2)}` : String(base ?? '—');
}

function section<T>(title: string, s: Section<T>, rows: string): string {
  const badge = s.ok
    ? `<span class="ok">live</span>`
    : `<span class="bad">unavailable</span>`;
  const body = s.ok ? rows || `<p class="dim">None yet.</p>` : `<p class="dim">${esc(s.error)}</p>`;
  return `<section><h2>${esc(title)} ${badge}</h2>${body}</section>`;
}

export function renderStatusHtml(s: UnifoldStatus): string {
  const t = (s.treasuries.data ?? [])
    .map(
      (a) => `<tr><td><code>${esc(a.id)}</code></td><td>${esc(a.chain_type)}</td>
        <td><code class="addr">${esc(a.address)}</code></td></tr>`,
    )
    .join('');

  const w = (s.webhooks.data ?? [])
    .map(
      (h) => `<tr><td><code>${esc(h.id)}</code></td><td><code class="addr">${esc(h.url)}</code></td>
        <td>${esc((h.enabled_events as unknown[] | undefined)?.length ?? '—')} events</td></tr>`,
    )
    .join('');

  const pi = (s.paymentIntents.data ?? [])
    .map(
      (p) => `<tr><td><code>${esc(p.id)}</code></td><td>${esc(p.status)}</td>
        <td>${usdc(p.destination_amount)}</td><td class="dim">${esc(p.created_at ?? '')}</td></tr>`,
    )
    .join('');

  const ot = (s.outboundTransfers.data ?? [])
    .map(
      (o) => `<tr><td><code>${esc(o.id)}</code></td><td>${esc(o.status)}</td>
        <td>${usdc(o.amount)}</td><td class="dim">${esc(o.created_at ?? '')}</td></tr>`,
    )
    .join('');

  // The gateway note must never overstate: a live account does not mean the demo spends money.
  const gatewayNote =
    s.gateway === 'unifold'
      ? `Buys are served by the <strong>real UnifoldGateway</strong> — clicks move real USDC.`
      : `Buys are currently served by <strong>StubGateway</strong>, so the demo spends nothing.
         This page is unaffected: it queries the live API directly with the same secret key the
         real gateway uses.`;

  return `<!doctype html><meta charset="utf-8"><title>Unifold integration — live status</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
 :root{--bg:#0f1012;--card:#17181c;--ink:#e9e6e1;--dim:#8b8781;--line:#26272c;--ok:#4ade80;--bad:#f87171;--accent:#ff7a5c}
 *{box-sizing:border-box}
 body{margin:0;padding:40px 20px;background:var(--bg);color:var(--ink);
   font:15px/1.6 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
 .wrap{max-width:860px;margin:0 auto}
 h1{font-size:22px;margin:0 0 6px}
 .sub{color:var(--dim);margin:0 0 26px;font-size:13.5px}
 section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin-bottom:16px}
 h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--dim);margin:0 0 12px;font-weight:600}
 table{width:100%;border-collapse:collapse;font-size:13.5px;display:block;overflow-x:auto}
 td{padding:7px 10px 7px 0;border-bottom:1px solid var(--line);vertical-align:top;white-space:nowrap}
 tr:last-child td{border-bottom:0}
 code{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--accent)}
 code.addr{color:var(--ink);word-break:break-all;white-space:normal}
 .ok,.bad{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;padding:2px 7px;border-radius:20px;margin-left:6px}
 .ok{background:rgba(74,222,128,.14);color:var(--ok)}
 .bad{background:rgba(248,113,113,.14);color:var(--bad)}
 .dim{color:var(--dim);font-size:13px;margin:4px 0 0}
 .kv{display:grid;grid-template-columns:auto 1fr;gap:6px 18px;font-size:13.5px}
 .kv div:nth-child(odd){color:var(--dim)}
 .note{border-left:2px solid var(--accent);padding-left:14px;color:var(--dim);font-size:13px;margin-top:22px}
 @media(prefers-color-scheme:light){
  :root{--bg:#faf8f5;--card:#fff;--ink:#1a1917;--dim:#6b6660;--line:#e7e3dd}
 }
</style>
<div class="wrap">
<h1>Unifold integration — live status</h1>
<p class="sub">Every value below was fetched from <code>${esc(s.apiBase)}</code> when you loaded this
page, using a live secret key. Nothing here is cached or mocked.<br>Checked at <strong>${esc(s.checkedAt)}</strong>.</p>

<section>
 <h2>Connection ${s.authenticated ? '<span class="ok">authenticated</span>' : '<span class="bad">failed</span>'}</h2>
 <div class="kv">
  <div>API key</div><div><code>${esc(s.keyPrefix)}</code> ${s.liveMode ? '(live mode)' : '(test mode)'}</div>
  <div>Webhook secret</div><div>${s.webhookSecretConfigured ? 'configured' : '<span class="bad">missing</span>'}</div>
  <div>Serving buys with</div><div>${esc(s.gateway)}</div>
 </div>
</section>

${section('Treasury accounts', s.treasuries, t && `<table>${t}</table>`)}
${section('Webhook endpoints', s.webhooks, w && `<table>${w}</table>`)}
${section('Payment intents (buys)', s.paymentIntents, pi && `<table>${pi}</table>`)}
${section('Outbound transfers (payouts)', s.outboundTransfers, ot && `<table>${ot}</table>`)}

<p class="note">${gatewayNote}<br><br>
This page proves the REST integration authenticates and the account is configured. It does not by
itself prove a payment settles end to end — a real payment intent reaching <code>succeeded</code>
in the table above is what shows that.</p>
</div>`;
}
