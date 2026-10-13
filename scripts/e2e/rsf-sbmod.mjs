// What '@/lib/supabase' resolves to during the Rashid import check: the REAL client (REST gateway of the install, signed in as the admin).
export const supabase = new Proxy({}, { get(_t, k) { return globalThis.__rvSupabase[k]; } });
export const cloudSupabase = supabase;
export async function getCurrentTenantIdAsync() { return globalThis.__rvTenant || null; }
export function getCurrentCompanyId() { return globalThis.__rvCompany || null; }
