import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const ALLOWED_ORIGINS = new Set(["https://thedougshelton.github.io"]);
const ALLOWED_SYNC_KEYS = new Set([
  "TAMPA_MONTHLY_AUDIT",
  "TAMPA_MONTHLY_AUDIT_FULL_AUDIT",
  "TAMPA_VACANT_UNIT_AUDIT",
  "TAMPA_VACANT_UNIT_AUDIT_FULL_AUDIT",
]);
const MAX_PAYLOAD_BYTES = 4_750_000;
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 30 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;

function allowedOrigin(origin: string): boolean {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function responseHeaders(origin: string): HeadersInit {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(origin) && origin ? origin : "https://thedougshelton.github.io",
    "Access-Control-Allow-Headers": "apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
}

function jsonResponse(origin: string, status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(origin) });
}

function secretKey(): string {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) {
    const parsed = JSON.parse(keys);
    if (parsed.default) return parsed.default;
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

Deno.serve(async request => {
  const origin = request.headers.get("Origin") || "";
  if (!allowedOrigin(origin)) return jsonResponse(origin, 403, { error: "Origin is not allowed." });
  if (request.method === "OPTIONS") return new Response("ok", { headers: responseHeaders(origin) });
  if (request.method !== "POST") return jsonResponse(origin, 405, { error: "Method is not allowed." });

  try {
    const key = secretKey();
    const url = Deno.env.get("SUPABASE_URL") || "";
    if (!key || !url) throw new Error("Cloud function is not configured.");
    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const body = await request.json();
    const pin = String(body.pin || "").trim();
    const action = String(body.action || "").toLowerCase();
    if (!/^\d{8,20}$/.test(pin)) return jsonResponse(origin, 401, { error: "Incorrect cloud PIN." });

    const forwarded = request.headers.get("x-forwarded-for") || request.headers.get("cf-connecting-ip") || "unknown";
    const clientKey = await sha256("inventory-pr:" + forwarded.split(",")[0].trim());
    const now = new Date();
    const { data: attempt } = await supabase
      .from("inventory_pr_cloud_attempts")
      .select("failed_attempts,window_started,blocked_until")
      .eq("client_key", clientKey)
      .maybeSingle();

    if (attempt?.blocked_until && new Date(attempt.blocked_until) > now) {
      return jsonResponse(origin, 429, { error: "Too many incorrect PIN attempts. Try again in 15 minutes." });
    }

    const { data: security, error: securityError } = await supabase
      .from("inventory_pr_cloud_security")
      .select("pin_salt,pin_hash")
      .eq("config_id", 1)
      .single();
    if (securityError || !security) throw new Error("Cloud security is not configured.");

    const enteredHash = await sha256(security.pin_salt + pin);
    if (!timingSafeEqual(enteredHash, security.pin_hash)) {
      const windowStarted = attempt?.window_started ? new Date(attempt.window_started) : now;
      const insideWindow = now.getTime() - windowStarted.getTime() < FAILURE_WINDOW_MS;
      const failedAttempts = insideWindow ? Number(attempt?.failed_attempts || 0) + 1 : 1;
      const blockedUntil = failedAttempts >= MAX_FAILURES ? new Date(now.getTime() + BLOCK_MS).toISOString() : null;
      await supabase.from("inventory_pr_cloud_attempts").upsert({
        client_key: clientKey,
        failed_attempts: failedAttempts,
        window_started: insideWindow ? windowStarted.toISOString() : now.toISOString(),
        blocked_until: blockedUntil,
        updated_at: now.toISOString(),
      });
      return jsonResponse(origin, failedAttempts >= MAX_FAILURES ? 429 : 401, {
        error: failedAttempts >= MAX_FAILURES
          ? "Too many incorrect PIN attempts. Try again in 15 minutes."
          : "Incorrect cloud PIN.",
      });
    }

    await supabase.from("inventory_pr_cloud_attempts").delete().eq("client_key", clientKey);

    if (action === "save") {
      const record = body.record || {};
      const syncKey = String(record.sync_key || "");
      if (!ALLOWED_SYNC_KEYS.has(syncKey)) return jsonResponse(origin, 400, { error: "Invalid audit cloud slot." });
      if (!record.payload || typeof record.payload !== "object") return jsonResponse(origin, 400, { error: "Audit payload is missing." });
      const payloadBytes = new TextEncoder().encode(JSON.stringify(record.payload)).length;
      if (payloadBytes > MAX_PAYLOAD_BYTES) return jsonResponse(origin, 413, { error: "Audit is too large for cloud save." });

      const { data, error } = await supabase.from("inventory_pr_secure_cloud").upsert({
        sync_key: syncKey,
        payload: record.payload,
        updated_at: now.toISOString(),
        updated_by: String(record.updated_by || "").toUpperCase().slice(0, 64),
      }, { onConflict: "sync_key" }).select("sync_key,updated_at,updated_by").single();
      if (error) throw error;
      return jsonResponse(origin, 200, { row: data });
    }

    if (action === "load") {
      const requested = Array.isArray(body.syncKeys) ? body.syncKeys.map(String) : [];
      const syncKeys = [...new Set(requested)].filter(keyValue => ALLOWED_SYNC_KEYS.has(keyValue)).slice(0, 2);
      if (!syncKeys.length) return jsonResponse(origin, 400, { error: "Invalid audit cloud slot." });
      const { data, error } = await supabase
        .from("inventory_pr_secure_cloud")
        .select("sync_key,payload,updated_at,updated_by")
        .in("sync_key", syncKeys);
      if (error) throw error;
      return jsonResponse(origin, 200, { rows: data || [] });
    }

    return jsonResponse(origin, 400, { error: "Unknown cloud action." });
  } catch (error) {
    console.error("Inventory cloud request failed", error instanceof Error ? error.message : "Unknown error");
    return jsonResponse(origin, 500, { error: "Cloud service could not complete the request." });
  }
});
