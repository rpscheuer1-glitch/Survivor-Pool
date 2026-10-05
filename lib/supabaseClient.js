import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // This only throws at runtime in the browser if the env vars weren't set,
  // which is the most common setup mistake — the error message says exactly what's missing.
  console.warn(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Check your .env.local file."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Supabase/PostgREST silently caps any single query at 1000 rows by
// default -- a query that looks like "give me everything" quietly loses
// data past that point with no error at all. Anywhere the app needs the
// FULL contents of a table (not scoped to one week/entry), use this instead
// of a plain .select("*") to page through everything safely, regardless of
// how large the table has grown.
//
// Crucially, this orders by a stable, unique column before paging. Without
// an explicit order, Postgres doesn't guarantee the same row lands in the
// same "page" across two separate range() calls -- especially with rows
// being actively inserted/updated at the same time (e.g. lots of people
// submitting picks right at a deadline), a row can genuinely fall through
// the gap between pages. `table` must have the given column (defaults to
// "id", which every table here has except `weeks`, which uses `week`).
export async function fetchAllRows(table, selectCols = "*", orderColumn = "id", client = supabase) {
  const pageSize = 1000;
  let from = 0;
  let allRows = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await client
      .from(table)
      .select(selectCols)
      .order(orderColumn, { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    allRows = allRows.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return allRows;
}
