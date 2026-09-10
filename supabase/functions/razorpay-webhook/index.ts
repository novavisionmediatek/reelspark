// Authoritative payment confirmation. Razorpay POSTs here on payment.captured;
// we HMAC-verify the raw body against RAZORPAY_WEBHOOK_SECRET, then run the
// idempotent confirm_razorpay_payment RPC. Deployed with verify_jwt = false
// (see supabase/config.toml) — the signature IS the auth.
//
// Returns 200 for everything handled or safely ignored, 400 only for a bad
// signature, 500 only for a transient error we want Razorpay to retry.
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { verifyWebhookSignature } from "../_shared/razorpay.ts";

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  // Read the exact bytes before parsing — the HMAC is over the raw body.
  const raw = await req.text();
  const signature = req.headers.get("x-razorpay-signature");

  if (!(await verifyWebhookSignature(raw, signature))) {
    console.warn("razorpay-webhook: bad or missing signature");
    return new Response("invalid signature", { status: 400 });
  }

  let event: {
    event?: string;
    payload?: { payment?: { entity?: { id?: string; order_id?: string; amount?: number } } };
  };
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  try {
    if (event.event === "payment.captured") {
      const entity = event.payload?.payment?.entity ?? {};
      const orderId = entity.order_id;
      const paymentId = entity.id;
      if (!orderId || !paymentId) return new Response("ok", { status: 200 });

      const admin = supabaseAdmin();
      const { data: row } = await admin
        .from("registration_payments")
        .select("id, status, amount_inr")
        .eq("razorpay_order_id", orderId)
        .maybeSingle();

      if (!row) {
        console.warn("razorpay-webhook: no payment row for order", orderId);
        return new Response("ok", { status: 200 });
      }
      if (row.status === "approved") return new Response("ok", { status: 200 });

      if (typeof entity.amount === "number" && entity.amount !== row.amount_inr * 100) {
        console.error("razorpay-webhook: amount mismatch", orderId, entity.amount, row.amount_inr);
        return new Response("ok", { status: 200 });
      }

      const { error } = await admin.rpc("confirm_razorpay_payment", {
        p_order_id: orderId,
        p_payment_id: paymentId,
        p_signature: "webhook:payment.captured",
      });
      if (error) {
        console.error("razorpay-webhook: confirm_razorpay_payment failed", error);
        return new Response("retry", { status: 500 });
      }
      return new Response("ok", { status: 200 });
    }

    if (event.event === "payment.failed") {
      console.log(
        "razorpay-webhook: payment.failed",
        event.payload?.payment?.entity?.order_id,
      );
      return new Response("ok", { status: 200 });
    }

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("razorpay-webhook unhandled", err);
    return new Response("retry", { status: 500 });
  }
});
