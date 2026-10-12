import { createClient } from "@supabase/supabase-js";

// SERVER-SIDE ONLY. Confirms who a request comes from. The browser sends its
// Supabase login token in an Authorization header; we ask Supabase whether
// that token is genuine. Returns { user, client } or null.
async function userFromRequest(request) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;

  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error } = await client.auth.getUser(token);
  if (error || !userData?.user) return null;
  return { user: userData.user, client };
}

// The logged-in user making this request, or null.
export async function getRequestUser(request) {
  return (await userFromRequest(request))?.user || null;
}

// The logged-in user making this request if they're an admin, otherwise null.
export async function getRequestAdmin(request) {
  const found = await userFromRequest(request);
  if (!found) return null;
  const { data: profile } = await found.client.from("profiles").select("is_admin").eq("id", found.user.id).single();
  return profile?.is_admin ? found.user : null;
}

// Returns true/false: is this request from a logged-in admin?
export async function requestIsAdmin(request) {
  return !!(await getRequestAdmin(request));
}
