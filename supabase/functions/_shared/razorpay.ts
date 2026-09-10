import { need } from "./env.ts";

const RAZORPAY_API = "https://api.razorpay.com/v1";

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
  receipt?: string;
}

/** Create a Razorpay order. Amount is in paise. */
export async function createOrder(opts: {
  amountPaise: number;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrder> {
  const auth = btoa(`${need("RAZORPAY_KEY_ID")}:${need("RAZORPAY_KEY_SECRET")}`);

  const res = await fetch(`${RAZORPAY_API}/orders`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: opts.amountPaise,
      currency: "INR",
      receipt: opts.receipt,
      notes: opts.notes ?? {},
    }),
  });

  if (!res.ok) {
    console.error("razorpay createOrder failed", res.status, await res.text());
    throw new Error("razorpay_order_failed");
  }
  return await res.json() as RazorpayOrder;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Checkout `handler` callback: HMAC-SHA256(order_id + "|" + payment_id) with the key SECRET. */
export async function verifyPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string,
): Promise<boolean> {
  const expected = await hmacSha256Hex(need("RAZORPAY_KEY_SECRET"), `${orderId}|${paymentId}`);
  return timingSafeEqual(expected, signature.toLowerCase());
}

/** Webhook: HMAC-SHA256(rawBody) with the WEBHOOK secret, compared to X-Razorpay-Signature. */
export async function verifyWebhookSignature(
  rawBody: string,
  signature: string | null,
): Promise<boolean> {
  if (!signature) return false;
  const expected = await hmacSha256Hex(need("RAZORPAY_WEBHOOK_SECRET"), rawBody);
  return timingSafeEqual(expected, signature.toLowerCase());
}
