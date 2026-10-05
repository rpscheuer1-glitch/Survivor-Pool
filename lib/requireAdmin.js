import { createClient } from "@supabase/supabase-js";

// SERVER-SIDE ONLY. Confirms a request really comes from a logged-in admin.
// The browser sends its Supabase login token in an Authorization header; we
// ask Supabase whether that token is genuine, then check the account's
// is_admin flag. Returns true/false.
export async function requestIsAdmin(request) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return false;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return false;

  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error } = await client.auth.getUser(token);
  if (error || !userData?.user) return false;

  const { data: profile } = await client.from("profiles").select("is_admin").eq("id", userData.user.id).single();
  return !!profile?.is_admin;
}
