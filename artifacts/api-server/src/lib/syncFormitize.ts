/**
 * Formitize API pull-sync
 *
 * Fetches recent form submissions directly from the Formitize REST API and
 * replays each one through the existing /api/formitize/webhook handler
 * (via internal HTTP POST to localhost).  All parsing, dedup, and insertion
 * logic lives in the webhook handler — we reuse it for free.
 *
 * Schedule: every 15 minutes (see index.ts).
 * Manual trigger: POST /api/formitize/api-sync  (superAdmin only).
 */

const FORMITIZE_BASES = [
  "https://service.formitize.com/api/v1",
  "https://app.formitize.com/api/v2",
];

// Form titles we care about (lower-cased prefix match)
const PULL_FORM_NAMES = [
  "new customer application",
  "hukuplus re-application",
  "hukuplus re application",
  "re-application",
  // Payroll / salary deduction (ChikweretiOne)
  "payroll deduction application",
  "salary deduction application",
  // Novafeed
  "novafeed application",
];

function wantForm(title: string): boolean {
  const t = title.toLowerCase();
  return PULL_FORM_NAMES.some(n => t.includes(n));
}

async function formitizeGet(path: string): Promise<{ ok: boolean; base: string; data: any }> {
  const apiKey = process.env.FORMITIZE_API_KEY;
  if (!apiKey) return { ok: false, base: "", data: { error: "FORMITIZE_API_KEY not set" } };

  for (const base of FORMITIZE_BASES) {
    try {
      const res = await fetch(`${base}${path}`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      });
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
      if (res.status < 500) return { ok: res.ok, base, data };
    } catch { /* try next base */ }
  }
  return { ok: false, base: "", data: { error: "All Formitize base URLs failed" } };
}

/**
 * Extract a flat array of submitted-form objects from any Formitize API
 * list-response shape.  The API is inconsistently documented across versions.
 */
function extractForms(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.data))   return data.data;
  if (data && Array.isArray(data.forms))  return data.forms;
  if (data && Array.isArray(data.result)) return data.result;
  if (data && data.result && Array.isArray(data.result.forms)) return data.result.forms;
  if (data && data.result && Array.isArray(data.result.data))  return data.result.data;
  return [];
}

/**
 * Normalise a single Formitize API submission record into a body that looks
 * like what the webhook receives.  The field names differ between API versions.
 */
function toWebhookBody(form: any): Record<string, any> {
  return {
    // Form title — try every known key name
    formTitle:
      form.formTitle ??
      form.title ??
      form.form_name ??
      form.FormName ??
      form.formName ??
      form.name ??
      "",

    // Submitted form ID (used as fallback job ID)
    submittedFormID: form.id ?? form.submittedFormId ?? form.submittedFormID ?? null,

    // Job ID — primary dedup key
    jobID: form.jobID ?? form.jobId ?? form.job_id ?? form.JobID ?? null,

    // Tracking category
    trackingCategory:
      form.trackingCategory ??
      form.tracking_category ??
      form.TrackingCategory ??
      (Array.isArray(form.trackingCategories) ? form.trackingCategories[0] : null) ??
      null,

    // Form field content — may already be nested under content, or flat
    content: form.content ?? form.fields ?? form.formData ?? form,
  };
}

// ── Result tracking ───────────────────────────────────────────────────────────

export interface ApiSyncResult {
  fetched:   number;
  relevant:  number;
  replayed:  number;
  skipped:   number;
  errors:    string[];
  apiBase:   string;
}

let _lastSyncAt: Date | null = null;
let _lastSyncResult: ApiSyncResult | null = null;

export function getLastApiSync() {
  return { lastSyncAt: _lastSyncAt, lastResult: _lastSyncResult };
}

// ── Main sync function ────────────────────────────────────────────────────────

export async function syncFormitizeSubmissions(opts: {
  /** How many recent submissions to fetch per request (default 100) */
  limit?: number;
  /** The local port our API is listening on, so we can POST to ourself */
  port: number;
}): Promise<ApiSyncResult> {
  const { limit = 100, port } = opts;
  const result: ApiSyncResult = {
    fetched: 0, relevant: 0, replayed: 0, skipped: 0, errors: [], apiBase: "",
  };

  // ── 1. Fetch recent submitted forms ────────────────────────────────────────
  const listPath = `/forms?limit=${limit}`;
  const listResp = await formitizeGet(listPath);
  result.apiBase = listResp.base;

  if (!listResp.ok) {
    result.errors.push(`Formitize list failed: ${JSON.stringify(listResp.data).slice(0, 200)}`);
    return result;
  }

  const forms = extractForms(listResp.data);
  result.fetched = forms.length;

  if (forms.length === 0) {
    // API responded OK but returned nothing — not an error, just quiet period
    _lastSyncAt = new Date();
    _lastSyncResult = result;
    return result;
  }

  // ── 2. Filter to forms we care about ───────────────────────────────────────
  const relevant = forms.filter((f: any) => {
    const title = String(
      f.formTitle ?? f.title ?? f.form_name ?? f.FormName ?? f.formName ?? f.name ?? ""
    );
    return wantForm(title);
  });
  result.relevant = relevant.length;

  // ── 3. Replay each relevant form through the webhook handler ───────────────
  const webhookUrl = `http://localhost:${port}/api/formitize/webhook`;

  for (const form of relevant) {
    const body = toWebhookBody(form);
    const formTitle = String(body.formTitle);

    try {
      const r = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        // 10-second timeout per form
        signal: AbortSignal.timeout(10_000),
      });

      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        result.errors.push(`"${formTitle}" (id=${body.submittedFormID}) → HTTP ${r.status}: ${txt.slice(0, 120)}`);
        continue;
      }

      const json: any = await r.json().catch(() => ({}));

      if (json?.skipped) {
        result.skipped++;
        console.log(`[formitize:api-sync] Skipped (already imported) — "${formTitle}" jobID=${body.jobID}`);
      } else {
        result.replayed++;
        console.log(`[formitize:api-sync] Replayed — "${formTitle}" jobID=${body.jobID}`);
      }
    } catch (err: any) {
      result.errors.push(`"${formTitle}": ${err.message?.slice(0, 120)}`);
    }
  }

  _lastSyncAt = new Date();
  _lastSyncResult = result;

  console.log(
    `[formitize:api-sync] Done — fetched=${result.fetched} relevant=${result.relevant} ` +
    `replayed=${result.replayed} skipped=${result.skipped} errors=${result.errors.length}`
  );

  return result;
}
