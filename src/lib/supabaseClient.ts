/**
 * supabaseClient.ts — ImageLab
 * Fetch-native Supabase REST client. Patrón idéntico a CopyLab.
 * No SDK — fetch directo a la REST API.
 */

const SUPABASE_URL     = import.meta.env.VITE_SUPABASE_URL  as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('[Supabase] Missing env vars: VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

const BASE = `${SUPABASE_URL}/rest/v1`;

function headers(extra?: Record<string, string>): Record<string, string> {
  return {
    'Content-Type':  'application/json',
    apikey:          SUPABASE_ANON_KEY,
    Authorization:   `Bearer ${SUPABASE_ANON_KEY}`,
    ...extra,
  };
}

export async function sbSelect<T>(
  table: string,
  query: string = '*',
  filters?: Record<string, string>
): Promise<T[]> {
  const params = new URLSearchParams({ select: query });
  if (filters) {
    for (const [key, val] of Object.entries(filters)) {
      params.set(key, val);
    }
  }
  const res = await fetch(`${BASE}/${table}?${params}`, {
    method: 'GET',
    headers: headers(),
  });
  if (!res.ok) throw new Error(`[Supabase] SELECT ${table} failed: ${await res.text()}`);
  return res.json();
}
