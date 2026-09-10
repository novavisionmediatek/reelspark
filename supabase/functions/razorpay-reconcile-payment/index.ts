// Reconciliation fallback: asks Razorpay's API directly whether an order has a
// captured payment, and if so runs the idempotent confirm_razorpay_payment RPC.
// Used by the "Check again" button and as a fallback when the Checkout `handler`
// callback to razorpay-verify-payment fails — so a paid membership still
// activates even with no webhook configured.
import { jsonResponse, preflight } from "../_shared/cors.ts";
import { HttpError, requireUser } from "../_shared/auth.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { fetchOrderPayments } from "../_shared/razorpay.ts";

interface PaymentRow {
  id: string;
  user_id: string;
  status: string;
  razorpay_order_id: string | null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");

    const user = await requireUser(req);
    const admin = supabaseAdmin();

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const orderId = String(body.razorpay_order_id ?? "");

    // Use the order id if given, else the caller's latest unconfirmed row.
    let row: PaymentRow | null = null;
    if (orderId) {
      const { data } = await admin
        .from("registration_payments")
        .select("id, user_id, status, razorpay_order_id")
        .eq("razorpay_order_id", orderId)
        .maybeSingle();
      row = data as PaymentRow | null;
    } else {
      const { data } = await admin
        .from("registration_payments")
        .select("id, user_id, status, razorpay_order_id")
        .eq("user_id", user.id)
        .in("status", ["created", "submitted"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      row = data as PaymentRow | null;
    }

    if (!row) return jsonResponse(req, { status: "none" });
    if (row.user_id !== user.id) throw new HttpError(403, "forbidden");
    if (row.status === "approved") return jsonResponse(req, { status: "approved" });
    if (!row.razorpay_order_id) return jsonResponse(req, { status: "pending" });

    const payments = await fetchOrderPayments(row.razorpay_order_id);
    // Only a captured payment means money actually moved. (Manual-capture setups
    // would leave it 'authorized' — that's a Razorpay dashboard config issue.)
    const captured = payments.find((p) => p.status === "captured");
    if (!captured) return jsonResponse(req, { status: "pending" });

    const { error } = await admin.rpc("confirm_razorpay_payment", {
      p_order_id: row.razorpay_order_id,
      p_payment_id: captured.id,
      p_signature: "reconcile:orders-payments",
    });
    if (error) {
      console.error("reconcile confirm_razorpay_payment failed", error);
      throw new HttpError(500, "confirm_failed");
    }

    return jsonResponse(req, { status: "approved" });
  } catch (err) {
    if (err instanceof HttpError) return jsonResponse(req, { error: err.code }, err.status);
    console.error("razorpay-reconcile-payment unhandled", err);
    return jsonResponse(req, { error: "internal_error" }, 500);
  }
});
