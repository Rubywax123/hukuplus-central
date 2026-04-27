import { pool } from "@workspace/db";

const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";

export interface XeroAuth {
  accessToken: string;
  tenantId: string;
}

/**
 * Returns valid Xero credentials, refreshing the access token if it is within
 * 10 minutes of expiry. Writes the refreshed token back to xero_tokens id=1.
 *
 * Returns null (with a console.warn) when:
 *  - No token row exists in the DB (Xero was never connected)
 *  - The refresh token call fails (token revoked or Xero auth expired)
 */
export async function getXeroAuth(): Promise<XeroAuth | null> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query("SELECT * FROM xero_tokens WHERE id = 1");
    const tokens = rows[0];

    if (!tokens) {
      console.warn("[xero-auth] No Xero tokens found — reconnect Xero in Settings.");
      return null;
    }

    const expiresAt = new Date(tokens.expires_at);
    const msToExpiry = expiresAt.getTime() - Date.now();

    // Refresh proactively if within 10 minutes of expiry (or already expired)
    if (msToExpiry < 10 * 60 * 1000) {
      const refreshed = await attemptTokenRefresh(client, tokens);
      if (!refreshed) return null;
      return refreshed;
    }

    return { accessToken: tokens.access_token, tenantId: tokens.tenant_id };
  } finally {
    client.release();
  }
}

/**
 * Proactively refreshes the Xero access token regardless of expiry time.
 * Call this on server startup so the token is fresh before any webhook fires.
 * Safe to call even if Xero is not connected — logs a warning and returns false.
 */
export async function proactiveXeroRefresh(): Promise<boolean> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query("SELECT * FROM xero_tokens WHERE id = 1");
    const tokens = rows[0];
    if (!tokens) {
      console.log("[xero-auth] Startup refresh skipped — Xero not connected.");
      return false;
    }
    const result = await attemptTokenRefresh(client, tokens);
    if (result) {
      console.log("[xero-auth] Startup token refresh succeeded.");
      return true;
    }
    return false;
  } finally {
    client.release();
  }
}

async function attemptTokenRefresh(
  client: any,
  tokens: any,
): Promise<XeroAuth | null> {
  const clientId     = process.env.XERO_CLIENT_ID;
  const clientSecret = process.env.XERO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("[xero-auth] XERO_CLIENT_ID / XERO_CLIENT_SECRET not set.");
    return null;
  }

  try {
    const res = await fetch(XERO_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 400 || res.status === 401) {
        console.error(
          "[xero-auth] Refresh token rejected by Xero — re-authentication required. " +
          "Go to Settings → Xero → Reconnect. Detail:", body.slice(0, 200),
        );
      } else {
        console.warn("[xero-auth] Token refresh failed:", res.status, body.slice(0, 200));
      }
      return null;
    }

    const data = await res.json() as any;
    const newExpiry = new Date(Date.now() + (data.expires_in as number) * 1000);

    await client.query(
      `UPDATE xero_tokens
          SET access_token  = $1,
              refresh_token = $2,
              expires_at    = $3,
              updated_at    = NOW()
        WHERE id = 1`,
      [data.access_token, data.refresh_token ?? tokens.refresh_token, newExpiry],
    );

    return { accessToken: data.access_token, tenantId: tokens.tenant_id };
  } catch (err: any) {
    console.error("[xero-auth] Network error during token refresh:", err.message);
    return null;
  }
}

export function xeroHeaders(auth: XeroAuth) {
  return {
    Authorization: `Bearer ${auth.accessToken}`,
    "Xero-tenant-id": auth.tenantId,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}
