import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { need } from "./env.ts";

/** A typed HTTP failure the function's top-level handler turns into a JSON response. */
export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export interface AuthedUser {
  id: string;
  email: string | null;
  phone: string | null;
}

/**
 * Resolve the caller from `Authorization: Bearer <supabase access token>`.
 * `supabase.functions.invoke()` forwards the signed-in session token automatically.
 */
export async function requireUser(req: Request): Promise<AuthedUser> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new HttpError(401, "unauthorized");

  const client = createClient(need("SUPABASE_URL"), need("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "unauthorized");

  return { id: data.user.id, email: data.user.email ?? null, phone: data.user.phone ?? null };
}
