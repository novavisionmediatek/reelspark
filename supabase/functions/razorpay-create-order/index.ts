// Creates a Razorpay order for the signed-in user's annual ReelSpark membership.
// The amount is read from app_settings server-side — never trusted from the
// client. Records a 'created' registration_payments row via start_razorpay_payment.
import { jsonResponse, preflight } from "../_shared/cors.ts";
import { HttpError, requireUser } from "../_shared/auth.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { createOrder } from "../_shared/razorpay.ts";
import { need } from "../_shared/env.ts";

const RENEWAL_WINDOW_DAYS = 30; // can't renew earlier than this before expiry
const RATE_LIMIT_WINDOW_MIN = 10;
const RATE_LIMIT_MAX = 5;

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");

    const user = await requireUser(req);
    const admin = supabaseAdmin();

    // 1. Membership state — block a pointlessly early renewal.
    const { data: profile, error: profErr } = await admin
      .from("profiles")
      .select("payment_status, paid_until")
      .eq("id", user.id)
      .single();
    if (profErr) {
      console.error("profile lookup failed", profErr);
      throw new HttpError(500, "profile_lookup_failed");
    }
    const paidUntil = profile?.paid_until ? new Date(profile.paid_until) : null;
    const earliestRenewal = new Date(Date.now() + RENEWAL_WINDOW_DAYS * 86_400_000);
    if (profile?.payment_status === "approved" && paidUntil && paidUntil > earliestRenewal) {
      return jsonResponse(req, { error: "membership_active", paidUntil: profile.paid_until }, 409);
    }

    // 2. Fee — server-authoritative.
    const { data: settings, error: setErr } = await admin
      .from("app_settings")
      .select("registration_fee_inr")
      .eq("id", true)
      .single();
    if (setErr) {
      console.error("settings lookup failed", setErr);
      throw new HttpError(500, "settings_lookup_failed");
    }
    const amountInr = Number(settings?.registration_fee_inr) || 300;
    const amountPaise = amountInr * 100;

    // 3. Rate limit — cap attempts per user.
    const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MIN * 60_000).toISOString();
    const { count, error: cntErr } = await admin
      .from("registration_payments")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", since);
    if (cntErr) {
      console.error("rate-limit count failed", cntErr);
      throw new HttpError(500, "rate_limit_check_failed");
    }
    if ((count ?? 0) >= RATE_LIMIT_MAX) {
      return jsonResponse(req, { error: "too_many_attempts" }, 429);
    }

    // 4. Create the order at Razorpay.
    const order = await createOrder({
      amountPaise,
      receipt: `reg_${user.id.slice(0, 8)}_${Date.now()}`,
      notes: { user_id: user.id, purpose: "registration" },
    });

    // 5. Record the pending attempt.
    const { error: rpcErr } = await admin.rpc("start_razorpay_payment", {
      p_user_id: user.id,
      p_amount_inr: amountInr,
      p_order_id: order.id,
    });
    if (rpcErr) {
      console.error("start_razorpay_payment failed", rpcErr);
      throw new HttpError(500, "start_payment_failed");
    }

    return jsonResponse(req, {
      orderId: order.id,
      amount: amountPaise,
      currency: "INR",
      keyId: need("RAZORPAY_KEY_ID"),
      registrationFeeInr: amountInr,
    });
  } catch (err) {
    if (err instanceof HttpError) return jsonResponse(req, { error: err.code }, err.status);
    console.error("razorpay-create-order unhandled", err);
    return jsonResponse(req, { error: "internal_error" }, 500);
  }
});
