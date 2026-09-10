import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthProvider';
import { colors } from '../theme/tokens';
import { loadCheckoutScript, looksLikePhone, openCheckout } from '../lib/razorpay';
import type { RegistrationPayment } from '../types/database';

// A 'created' row older than this is treated as an abandoned checkout, not an
// in-flight one — matches the reuse window in start_razorpay_payment.
export const CREATED_FRESH_MS = 15 * 60 * 1000;

export function isConfirming(payment: RegistrationPayment | null | undefined): boolean {
  if (!payment) return false;
  if (payment.status === 'submitted') return true;
  return (
    payment.status === 'created' &&
    Date.now() - new Date(payment.created_at).getTime() < CREATED_FRESH_MS
  );
}

// The current user's most recent registration payment attempt. While it's still
// mid-flight (a fresh 'created' Razorpay order, or a legacy 'submitted' row) we
// poll so a webhook-only confirmation still flips the UI.
export function useRegistrationPayment() {
  const { session } = useAuth();
  const userId = session?.user.id;

  return useQuery({
    queryKey: ['registrationPayment', userId],
    enabled: !!userId,
    refetchInterval: (query) => {
      return isConfirming(query.state.data as RegistrationPayment | null) ? 15000 : false;
    },
    queryFn: async () => {
      const { data, error } = await supabase
        .from('registration_payments')
        .select('*')
        .eq('user_id', userId!)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as RegistrationPayment | null) ?? null;
    },
  });
}

interface CreateOrderResponse {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
  registrationFeeInr: number;
}

// supabase.functions.invoke throws a FunctionsHttpError for any non-2xx; the real
// { error: "<code>" } body is on error.context (a Response). Unwrap it so callers
// see e.g. "membership_active" instead of "Edge Function returned a non-2xx...".
async function invokeFn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let code = error.message;
    try {
      const parsed = await (error as { context?: Response }).context?.json?.();
      if (parsed && typeof parsed.error === 'string') code = parsed.error;
    } catch {
      /* body wasn't JSON — keep the generic message */
    }
    throw new Error(code);
  }
  return data as T;
}

export type PayOutcome = 'verified' | 'pending_webhook';

// Opens Razorpay Checkout for the annual membership fee.
//  - resolves 'verified'        — payment done and our verify call confirmed it
//  - resolves 'pending_webhook' — payment done, verify call failed; the webhook
//                                 will confirm shortly (show a "confirming" state)
//  - rejects  Error('cancelled')       — user closed the widget
//  - rejects  Error(<reason>)          — payment failed / order couldn't be created
export function usePayWithRazorpay() {
  const queryClient = useQueryClient();
  const { session, profile, refreshProfile } = useAuth();

  return useMutation<PayOutcome, Error, void>({
    mutationFn: async () => {
      await loadCheckoutScript();
      const order = await invokeFn<CreateOrderResponse>('razorpay-create-order', {});

      return await new Promise<PayOutcome>((resolve, reject) => {
        let done = false;
        const finish = (fn: () => void) => {
          if (done) return;
          done = true;
          fn();
        };

        const rzp = openCheckout({
          key: order.keyId,
          order_id: order.orderId,
          amount: order.amount,
          currency: order.currency,
          name: 'ReelSpark',
          description: `Annual membership (₹${order.registrationFeeInr}/year)`,
          // Only a public HTTPS URL — a localhost favicon trips up Checkout.
          image:
            typeof window !== 'undefined' && window.location.protocol === 'https:'
              ? `${window.location.origin}/favicon.png`
              : undefined,
          prefill: {
            name: profile?.display_name ?? undefined,
            email: profile?.email ?? undefined,
            contact: looksLikePhone(profile?.phone) ? profile.phone : undefined,
          },
          notes: { purpose: 'registration' },
          theme: { color: colors.purple },
          handler: (resp) => {
            invokeFn('razorpay-verify-payment', {
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature,
            })
              .then(() => finish(() => resolve('verified')))
              .catch(async (verifyErr) => {
                // Payment succeeded at Razorpay but our signature-verify call
                // didn't confirm. Fall back to reconciling against Razorpay's
                // API directly (works with no webhook configured).
                console.error('[razorpay] verify-payment failed, reconciling:', verifyErr);
                try {
                  const r = await invokeFn<{ status: string }>('razorpay-reconcile-payment', {
                    razorpay_order_id: resp.razorpay_order_id,
                  });
                  finish(() => resolve(r.status === 'approved' ? 'verified' : 'pending_webhook'));
                } catch (reconcileErr) {
                  console.error('[razorpay] reconcile failed:', reconcileErr);
                  finish(() => resolve('pending_webhook'));
                }
              });
          },
          modal: { ondismiss: () => finish(() => reject(new Error('cancelled'))) },
        });

        rzp.on('payment.failed', (e) => {
          finish(() => reject(new Error(e?.error?.description ?? 'Payment failed. Please try again.')));
        });
      });
    },
    onSuccess: async () => {
      await refreshProfile();
      queryClient.invalidateQueries({ queryKey: ['registrationPayment', session?.user.id] });
    },
  });
}

export interface ReconcileResult {
  status: 'approved' | 'pending' | 'none';
}

// "Check again" on the confirming screen: asks the server to reconcile the
// latest unconfirmed payment against Razorpay's API and confirm it if paid.
export function useReconcilePayment() {
  const queryClient = useQueryClient();
  const { session, refreshProfile } = useAuth();

  return useMutation<ReconcileResult, Error, void>({
    mutationFn: () => invokeFn<ReconcileResult>('razorpay-reconcile-payment', {}),
    onSuccess: async () => {
      await refreshProfile();
      queryClient.invalidateQueries({ queryKey: ['registrationPayment', session?.user.id] });
    },
  });
}
