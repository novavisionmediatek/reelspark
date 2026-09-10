import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { need } from "./env.ts";

let cached: SupabaseClient | null = null;

/**
 * Service-role client for calling the service-role-only payment RPCs
 * (start_razorpay_payment / confirm_razorpay_payment) and reading settings.
 * Bypasses RLS — never expose its results directly to a caller without checks.
 */
export function supabaseAdmin(): SupabaseClient {
  if (!cached) {
    cached = createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
