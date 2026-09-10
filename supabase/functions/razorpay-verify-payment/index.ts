// Verifies the Razorpay Checkout `handler` callback (fast path to unlock the UI)
// and confirms the payment via the idempotent confirm_razorpay_payment RPC.
// The razorpay-webhook function is the authoritative backstop for this.
import { jsonResponse, preflight } from "../_shared/cors.ts";
import { HttpError, requireUser } from "../_shared/auth.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { verifyPaymentSignature } from "../_shared/razorpay.ts";

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");

    const user = await requireUser(req);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const orderId = String(body.razorpay_order_id ?? "");
    const paymentId = String(body.razorpay_payment_id ?? "");
    const signature = String(body.razorpay_signature ?? "");
    if (!orderId || !paymentId || !signature) throw new HttpError(400, "missing_fields");

    if (!(await verifyPaymentSignature(orderId, paymentId, signature))) {
      throw new HttpError(400, "bad_signature");
    }

    const admin = supabaseAdmin();

    const { data: row, error: rowErr } = await admin
      .from("registration_payments")
      .select("id, user_id, status")
      .eq("razorpay_order_id", orderId)
      .maybeSingle();
    if (rowErr) {
      console.error("payment row lookup failed", rowErr);
      throw new HttpError(500, "lookup_failed");
    }
    if (!row) throw new HttpError(404, "order_not_found");
    if (row.user_id !== user.id) throw new HttpError(403, "forbidden");
    if (row.status === "approved") return jsonResponse(req, { status: "approved" });

    const { error: rpcErr } = await admin.rpc("confirm_razorpay_payment", {
      p_order_id: orderId,
      p_payment_id: paymentId,
      p_signature: signature,
    });
    if (rpcErr) {
      console.error("confirm_razorpay_payment failed", rpcErr);
      throw new HttpError(500, "confirm_failed");
    }

    return jsonResponse(req, { status: "approved" });
  } catch (err) {
    if (err instanceof HttpError) return jsonResponse(req, { error: err.code }, err.status);
    console.error("razorpay-verify-payment unhandled", err);
    return jsonResponse(req, { error: "internal_error" }, 500);
  }
});
