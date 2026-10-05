import { createClient } from "@supabase/supabase-js";

// SERVER-SIDE ONLY. Uses the Supabase service-role key, which bypasses all
// row-level security -- so it must never be imported by any page or component
// that runs in the browser, and the key must never be given a NEXT_PUBLIC_
// name. Only API routes (app/api/...) import this.
//
// Returns null if the key isn't configured, so callers can fail safely instead
// of quietly running with less access than they expect.
export function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
