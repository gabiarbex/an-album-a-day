import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const TOKEN_HASH = "b63736ae23e2f94a54e41d89ac9e2369af1927dc35b542448062666638c9d717";
const PAYMENT_LINK_ID = "plink_1UYSStEhqOWth5osA2rbD4o3";
const SUPPORTER_PRICE_ID = "price_1UYSSnEhqOWth5ospaDNyJEv";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function safeString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function unixToIso(value: unknown) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

function subscriptionIdFromInvoice(invoice: any) {
  return safeString(invoice?.subscription)
    || safeString(invoice?.subscription_details?.subscription)
    || safeString(invoice?.parent?.subscription_details?.subscription);
}

async function verifyStripeSignature(rawBody: string, signatureHeader: string, secret: string) {
  const parts = signatureHeader.split(",").map(part => part.trim());
  const timestampPart = parts.find(part => part.startsWith("t="));
  const signatures = parts.filter(part => part.startsWith("v1=")).map(part => part.slice(3));
  const timestamp = Number(timestampPart?.slice(2));
  if (!Number.isFinite(timestamp) || !signatures.length) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (age > 300) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${rawBody}`));
  const expected = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");

  return signatures.some(candidate => {
    if (candidate.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ candidate.charCodeAt(i);
    return diff === 0;
  });
}

async function findUserForCheckout(admin: any, object: any) {
  const email = (safeString(object?.customer_details?.email) || safeString(object?.customer_email) || "").toLowerCase();
  const reference = safeString(object?.client_reference_id);

  if (reference && UUID_RE.test(reference)) {
    const { data, error } = await admin.auth.admin.getUserById(reference);
    if (!error && data?.user) {
      const userEmail = String(data.user.email || "").toLowerCase();
      if (!email || userEmail === email) return data.user;
      console.warn("supporter_reference_email_mismatch", { checkout_reference: reference });
      return null;
    }
  }

  if (!email) return null;
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const users = Array.isArray(data?.users) ? data.users : [];
    const match = users.find((user: any) => String(user?.email || "").toLowerCase() === email);
    if (match) return match;
    if (users.length < 100) break;
  }
  return null;
}

async function updateExisting(admin: any, identifiers: { subscriptionId?: string | null; customerId?: string | null }, patch: Record<string, unknown>) {
  let query = admin.from("supporter_entitlements").update({
    ...patch,
    updated_at: new Date().toISOString(),
  });
  if (identifiers.subscriptionId) query = query.eq("stripe_subscription_id", identifiers.subscriptionId);
  else if (identifiers.customerId) query = query.eq("stripe_customer_id", identifiers.customerId);
  else return 0;
  const { data, error } = await query.select("user_id");
  if (error) throw error;
  return Array.isArray(data) ? data.length : 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = new URL(req.url);
  const suppliedToken = url.searchParams.get("token") || "";
  if (!suppliedToken || await sha256Hex(suppliedToken) !== TOKEN_HASH) {
    return json({ error: "unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretBundle = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
  const supabaseSecret = secretBundle.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseSecret) return json({ error: "server_not_configured" }, 500);

  const admin = createClient(supabaseUrl, supabaseSecret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: config, error: configError } = await admin
    .from("billing_webhook_config")
    .select("secret_value")
    .eq("key", "stripe_supporter_webhook_signing_secret")
    .maybeSingle();

  if (configError || !config?.secret_value) return json({ error: "server_not_configured" }, 500);

  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature") || "";
  if (!await verifyStripeSignature(rawBody, signature, config.secret_value)) {
    return json({ error: "invalid_signature" }, 401);
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  if (!event?.livemode || !safeString(event?.type) || !event?.data?.object) {
    return json({ error: "invalid_event" }, 400);
  }

  const type = event.type;
  const object = event.data.object;

  try {
    if (type === "checkout.session.completed") {
      if (
        object?.mode !== "subscription"
        || safeString(object?.payment_link) !== PAYMENT_LINK_ID
        || safeString(object?.metadata?.app) !== "album_a_day"
        || safeString(object?.metadata?.tier) !== "supporter"
      ) {
        return json({ ok: true, ignored: true });
      }

      const user = await findUserForCheckout(admin, object);
      if (!user) {
        console.warn("supporter_checkout_no_matching_user", {
          event_id: event.id,
          has_reference: Boolean(object?.client_reference_id),
          has_email: Boolean(object?.customer_details?.email || object?.customer_email),
        });
        return json({ ok: true, pending_match: true });
      }

      const subscriptionId = safeString(object?.subscription);
      const customerId = safeString(object?.customer);
      const checkoutPaid = object?.payment_status === "paid" || object?.payment_status === "no_payment_required";
      const { error } = await admin.from("supporter_entitlements").upsert({
        user_id: user.id,
        status: checkoutPaid ? "active" : "pending",
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        stripe_price_id: SUPPORTER_PRICE_ID,
        amount: Number.isFinite(Number(object?.amount_total)) ? Number(object.amount_total) : 300,
        currency: safeString(object?.currency) || "usd",
        cancel_at_period_end: false,
        source: "stripe",
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (error) throw error;
      return json({ ok: true, entitlement: checkoutPaid ? "active" : "pending" });
    }

    if (type === "customer.subscription.updated" || type === "customer.subscription.deleted") {
      const subscriptionId = safeString(object?.id);
      const customerId = safeString(object?.customer);
      const item = Array.isArray(object?.items?.data) ? object.items.data[0] : null;
      const patch = {
        status: type === "customer.subscription.deleted" ? "canceled" : (safeString(object?.status) || "active"),
        stripe_price_id: safeString(item?.price?.id) || SUPPORTER_PRICE_ID,
        amount: Number.isFinite(Number(item?.price?.unit_amount)) ? Number(item.price.unit_amount) : 300,
        currency: safeString(item?.price?.currency) || "usd",
        current_period_end: unixToIso(object?.current_period_end || item?.current_period_end),
        cancel_at_period_end: Boolean(object?.cancel_at_period_end),
      };
      const count = await updateExisting(admin, { subscriptionId, customerId }, patch);
      return json({ ok: true, updated: count });
    }

    if (type === "invoice.payment_failed" || type === "invoice.paid") {
      const subscriptionId = subscriptionIdFromInvoice(object);
      const customerId = safeString(object?.customer);
      const count = await updateExisting(admin, { subscriptionId, customerId }, {
        status: type === "invoice.payment_failed" ? "past_due" : "active",
      });
      return json({ ok: true, updated: count });
    }

    return json({ ok: true, ignored: true });
  } catch (error) {
    console.error("supporter_webhook_error", { event_id: event?.id, type, error: String(error?.message || error) });
    return json({ error: "processing_failed" }, 500);
  }
});
