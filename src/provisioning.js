'use strict';
// ════════════════════════════════════════════════════════════════
// provisioning — creating a tenant, its owner and its first company on a LOCAL install.
//
// 2.0.0 rules (each one is a bug 1.x/1.9.0 hit on a real customer machine):
//   * Every tenant-creating path sets tenants.owner_email AND user_profiles.is_tenant_admin = true. Production's
//     ownership check (fn_actor_owns_tenant_strict) keys on them; without them the owner could not create a company,
//     read accounting, or run an import. healTenantOwners() repairs any tenant that lacks them, at every start.
//   * The company is created by the SERVER functions, signed in as that admin — never by hand-written INSERTs:
//       purpose '' / blank → fn_provision_new_company
//       purpose 'rsf_import' → fn_provision_import_target_company (empty, status 'provisioning', returns companyId +
//                              provisioningKey for the importer to adopt)
//   * EMAIL_EXISTS is decided from auth.users BEFORE anything is written.
//   * NEVER look a user up through GoTrue's GET /admin/users?email=…: GoTrue ignores that parameter and returns the page
//     of ALL users — the 1.x code then deleted the newest user (someone else's). Cleanup here is scoped to the tenant uuid
//     and to the user id that THIS call created, nothing else.
//   * The default currency is the user's choice (or the imported file's) — there is no hidden 'SAR'.
// ════════════════════════════════════════════════════════════════
const http = require('http');
const crypto = require('crypto');

const MIN_PASSWORD_LENGTH = 6; // same floor the ERP's own forms enforce (LOCAL_ADMIN_MIN_PASSWORD_LENGTH)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class ProvisioningError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}

// ─── tiny JSON-over-HTTP client (GoTrue / PostgREST are on loopback) ─────────
function httpJson(method, urlStr, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const payload = body === undefined ? '' : JSON.stringify(body);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: { 'Content-Type': 'application/json', ...headers, ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
      timeout: 60000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let parsed = data;
        try { parsed = data ? JSON.parse(data) : null; } catch { /* keep text */ }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`timeout calling ${method} ${u.pathname}`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const normEmail = (e) => String(e || '').trim().toLowerCase();

/** Validate + normalise the request. Returns { ok, errors[], value }. */
function normaliseInput(data) {
  const d = data || {};
  const errors = [];
  const companyName = String(d.companyName || '').trim();
  if (!companyName) errors.push('companyName is required');
  let email = normEmail(d.adminEmail);
  if (!email && d.adminUsername) email = normEmail(`${String(d.adminUsername).replace(/\s+/g, '_')}@texacore.local`);
  if (!email || !EMAIL_RE.test(email)) errors.push('a valid adminEmail is required');
  const password = String(d.adminPassword || '');
  if (password.length < MIN_PASSWORD_LENGTH) errors.push(`adminPassword must be at least ${MIN_PASSWORD_LENGTH} characters`);
  const cur = (v) => (v === undefined || v === null || v === '' ? '' : String(v).trim().toUpperCase());
  const localCurrency = cur(d.localCurrency);
  if (!/^[A-Z]{3}$/.test(localCurrency)) errors.push('localCurrency (ISO 4217, 3 letters) is required — it comes from the user\'s choice or the imported file; there is no default');
  const mainCurrency = cur(d.mainCurrency);
  if (mainCurrency && !/^[A-Z]{3}$/.test(mainCurrency)) errors.push('mainCurrency must be an ISO 4217 code');
  const country = String(d.country || '').trim().toUpperCase();
  if (country && !/^[A-Z]{2}$/.test(country)) errors.push('country must be an ISO 3166-1 alpha-2 code');
  const purpose = String(d.purpose || '').trim();
  if (purpose && purpose !== 'rsf_import') errors.push(`unknown purpose "${purpose}"`);
  const fy = d.fiscalYearStart === undefined || d.fiscalYearStart === '' ? 1 : Number(d.fiscalYearStart);
  if (!Number.isInteger(fy) || fy < 1 || fy > 12) errors.push('fiscalYearStart must be a month 1..12');
  return {
    ok: errors.length === 0, errors,
    value: {
      companyName, email, password, localCurrency, mainCurrency, country, purpose,
      adminName: String(d.adminName || d.adminUsername || '').trim() || companyName,
      city: String(d.city || '').trim(), phone: String(d.phone || '').trim(), address: String(d.address || '').trim(),
      chartTemplate: String(d.chartTemplate || 'extended'), fiscalYearStart: fy, language: String(d.language || 'ar'),
    },
  };
}

/** Run fn(client) on a short-lived superuser connection (the installer's own DB access). */
async function withClient(deps, fn) {
  const client = await deps.connect();
  try { return await fn(client); } finally { try { await client.end(); } catch { /* ignore */ } }
}

async function emailExists(client, email) {
  const r = await client.query('SELECT 1 FROM auth.users WHERE lower(email) = $1 LIMIT 1', [email]);
  return r.rowCount > 0;
}

/**
 * Create tenant + owner + company. See the file header for the rules.
 * deps: { connect(): Promise<pg.Client>, gotrueUrl, restUrl, anonKey, serviceKey, ensureSubscription(tenantId), log }
 * Returns { success:true, ... } or { success:false, code, error } — it never throws for expected failures.
 */
async function createLocalCompany(deps, rawInput) {
  const log = deps.log || (() => {});
  const norm = normaliseInput(rawInput);
  if (!norm.ok) return { success: false, code: 'INVALID_INPUT', error: norm.errors.join('; '), errors: norm.errors };
  const v = norm.value;

  const created = { tenantId: null, userId: null };
  try {
    // 1. EMAIL_EXISTS — decided before a single row is written
    if (await withClient(deps, (c) => emailExists(c, v.email))) {
      return { success: false, code: 'EMAIL_EXISTS', error: 'This email is already registered on this computer. Use another email, or sign in with it.' };
    }

    // 2. tenant — with its owner_email from the start
    const tenantId = crypto.randomUUID();
    created.tenantId = tenantId;
    await withClient(deps, async (c) => {
      await c.query('BEGIN');
      try {
        await c.query(`SELECT set_config('app.is_registering', 'true', true)`);
        await c.query(
          `INSERT INTO public.tenants (id, code, name, email, owner_email, owner_name, country, default_language, default_currency, status,
                                       product_id)
           VALUES ($1, $2, $3, $4, $4, $5, NULLIF($6, ''), $7, $8, 'active', (SELECT id FROM public.saas_products WHERE code = 'texacore' LIMIT 1))`,
          [tenantId, `T-${crypto.randomBytes(5).toString('hex').toUpperCase()}`, v.companyName, v.email, v.adminName, v.country, v.language, v.localCurrency]);
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; }
    });
    log(`[Provision] tenant ${tenantId} created (owner ${v.email})`);

    // 3. the auth user (GoTrue admin API; the trigger on auth.users writes the profile row)
    const create = await httpJson('POST', `${deps.gotrueUrl}/admin/users`, {
      headers: { apikey: deps.serviceKey, Authorization: `Bearer ${deps.serviceKey}` },
      body: {
        email: v.email, password: v.password, email_confirm: true,
        user_metadata: { full_name: v.adminName, role: 'admin' },
        app_metadata: { provider: 'email', providers: ['email'], tenant_id: tenantId },
      },
    });
    if (create.status !== 200 && create.status !== 201) {
      const ec = create.body && (create.body.error_code || create.body.code);
      await cleanup(deps, created, log);
      if (ec === 'email_exists' || create.status === 422) {
        return { success: false, code: 'EMAIL_EXISTS', error: 'This email is already registered on this computer.' };
      }
      return { success: false, code: 'AUTH_USER_FAILED', error: `Could not create the sign-in account (${create.status}): ${JSON.stringify(create.body)}` };
    }
    created.userId = create.body.id;
    log(`[Provision] auth user ${created.userId} created`);

    // 4. ownership: tenant-admin flag, role, active — one transaction
    await withClient(deps, async (c) => {
      await c.query('BEGIN');
      try {
        await c.query(`SELECT set_config('app.is_registering', 'true', true)`);
        await c.query(
          `INSERT INTO public.user_profiles (id, email, full_name, role, tenant_id, is_active, is_tenant_admin)
           VALUES ($1, $2, $3, 'admin', $4, true, true)
           ON CONFLICT (id) DO UPDATE SET role = 'admin', tenant_id = EXCLUDED.tenant_id, is_active = true, is_tenant_admin = true,
                                          full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), public.user_profiles.full_name)`,
          [created.userId, v.email, v.adminName, tenantId]);
        await c.query(
          `INSERT INTO public.user_roles (user_id, role_id, tenant_id, company_id, is_active)
           SELECT $1, r.id, $2, NULL, true FROM public.roles r WHERE r.code = 'tenant_owner' AND r.tenant_id IS NULL LIMIT 1
           ON CONFLICT DO NOTHING`, [created.userId, tenantId]);
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; }
    });

    // 5. the subscription (plan + modules) the company-creation quota check needs
    if (deps.ensureSubscription) await deps.ensureSubscription(tenantId);

    // 6. sign in as that admin
    const signIn = await httpJson('POST', `${deps.gotrueUrl}/token?grant_type=password`, {
      headers: { apikey: deps.anonKey }, body: { email: v.email, password: v.password },
    });
    if (signIn.status !== 200 || !signIn.body || !signIn.body.access_token) {
      throw new ProvisioningError('SIGN_IN_FAILED', `The new admin could not sign in (${signIn.status}): ${JSON.stringify(signIn.body)}`);
    }
    const { access_token: accessToken, refresh_token: refreshToken } = signIn.body;
    const rpc = (fn, args) => httpJson('POST', `${deps.restUrl}/rpc/${fn}`, {
      headers: { apikey: deps.anonKey, Authorization: `Bearer ${accessToken}` }, body: args,
    });

    // 7. the company — through the server functions, as the admin
    const supported = [...new Set([v.localCurrency, v.mainCurrency].filter(Boolean))];
    const key = `local-setup:${crypto.randomUUID()}`;
    let companyId; let provisioningKey = null; let createdSource = null;
    if (v.purpose === 'rsf_import') {
      const r = await rpc('fn_provision_import_target_company', {
        p_tenant_id: tenantId, p_company_name: v.companyName, p_currency: v.localCurrency, p_country_code: v.country || null,
        p_idempotency_key: key, p_created_source: 'rsf_import', p_supported_currencies: supported,
      });
      if (r.status !== 200 || !r.body || !r.body.company_id) {
        throw new ProvisioningError('COMPANY_FAILED', `fn_provision_import_target_company failed (${r.status}): ${JSON.stringify(r.body)}`);
      }
      companyId = r.body.company_id; provisioningKey = r.body.operation_key || key; createdSource = 'rsf_import';
    } else {
      const r = await rpc('fn_provision_new_company', {
        p_tenant_id: tenantId, p_idempotency_key: key,
        p_company: {
          name: v.companyName, business_type: 'general', company_type: 'production',
          country_code: v.country || undefined, city: v.city || undefined, phone: v.phone || undefined, address: v.address || undefined,
          default_currency: v.localCurrency, supported_currencies: supported,
          chart_template: v.chartTemplate, fiscal_year_start_month: v.fiscalYearStart, language: v.language,
        },
      });
      if (r.status !== 200 || !r.body || !(r.body.company_id || r.body.success)) {
        throw new ProvisioningError('COMPANY_FAILED', `fn_provision_new_company failed (${r.status}): ${JSON.stringify(r.body)}`);
      }
      companyId = r.body.company_id;
    }

    // 8. the admin's active company
    await withClient(deps, async (c) => {
      await c.query('BEGIN');
      try {
        await c.query(`SELECT set_config('app.is_registering', 'true', true)`);
        await c.query('UPDATE public.user_profiles SET company_id = $2 WHERE id = $1 AND company_id IS NULL', [created.userId, companyId]);
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; }
    });
    log(`[Provision] company ${companyId} created (${v.purpose || 'blank'})`);

    return {
      success: true, tenantId, companyId, adminUserId: created.userId, adminEmail: v.email,
      accessToken, refreshToken, provisioningKey, createdSource, localCurrency: v.localCurrency,
    };
  } catch (err) {
    log(`[Provision] failed: ${err.message}`);
    try { await cleanup(deps, created, log); } catch (e) { log(`[Provision] cleanup failed: ${e.message}`); }
    return { success: false, code: err.code || 'PROVISION_FAILED', error: err.message };
  }
}

/**
 * Undo what THIS call created, and nothing else: the auth user whose id we were handed, and the tenant whose uuid we
 * generated (its tenant-scoped rows go with it). No lookup by email, no "newest user", no listing.
 */
async function cleanup(deps, created, log) {
  if (created.userId) {
    const r = await httpJson('DELETE', `${deps.gotrueUrl}/admin/users/${created.userId}`, {
      headers: { apikey: deps.serviceKey, Authorization: `Bearer ${deps.serviceKey}` },
    });
    log(`[Provision] cleanup: auth user ${created.userId} → ${r.status}`);
  }
  if (created.tenantId) {
    await withClient(deps, async (c) => {
      await c.query('BEGIN');
      try {
        await c.query(`SELECT set_config('app.is_registering', 'true', true)`);
        // only if nothing durable hangs off it yet (a company would mean the creation actually succeeded)
        const has = await c.query('SELECT 1 FROM public.companies WHERE tenant_id = $1 LIMIT 1', [created.tenantId]);
        if (has.rowCount === 0) {
          await c.query('DELETE FROM public.tenants WHERE id = $1', [created.tenantId]);
          log(`[Provision] cleanup: tenant ${created.tenantId} removed`);
        }
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; }
    });
  }
}

/**
 * Run at every start. For each tenant that has users: owner_email = the earliest tenant-admin/admin user's email when
 * missing, and the owner profile flagged is_tenant_admin. Idempotent; touches only rows that lack the data.
 * deps: { pgQuery(text, params) }   → { tenants, profiles }
 */
async function healTenantOwners({ pgQuery, log = () => {} }) {
  const out = { tenants: 0, profiles: 0 };
  // (a maintenance session has no JWT claims, which production's guards read as a privileged server context)
  const t = await pgQuery(`
    WITH cand AS (
      SELECT DISTINCT ON (up.tenant_id) up.tenant_id, au.email
        FROM public.user_profiles up JOIN auth.users au ON au.id = up.id
       WHERE up.tenant_id IS NOT NULL AND au.email IS NOT NULL AND COALESCE(up.is_active, true)
       ORDER BY up.tenant_id, (up.is_tenant_admin IS TRUE) DESC, (up.role IN ('admin','tenant_owner','owner')) DESC, au.created_at ASC
    )
    UPDATE public.tenants t SET owner_email = c.email, updated_at = now()
      FROM cand c WHERE t.id = c.tenant_id AND (t.owner_email IS NULL OR btrim(t.owner_email) = '')
    RETURNING t.id`);
  out.tenants = t.rowCount;
  if (out.tenants) log(`[Provision] healTenantOwners: owner_email restored on ${out.tenants} tenant(s)`);
  // the owner (profile whose auth email = tenants.owner_email) must carry the tenant-admin flag
  const p = await pgQuery(`
    UPDATE public.user_profiles up SET is_tenant_admin = true
      FROM public.tenants t, auth.users au
     WHERE up.tenant_id = t.id AND au.id = up.id AND lower(au.email) = lower(t.owner_email)
       AND up.is_tenant_admin IS DISTINCT FROM true
    RETURNING up.id`);
  out.profiles = p.rowCount;
  if (out.profiles) log(`[Provision] healTenantOwners: is_tenant_admin set on ${out.profiles} profile(s)`);
  return out;
}

/**
 * The vendor's support account (present ONLY on the vendor's own machine — see vendor-support.js). Looked up by SQL on
 * auth.users (never through GoTrue's list endpoint), created through the admin API when absent, then linked to the tenant's
 * company as a platform admin. Idempotent. deps as createLocalCompany.
 */
async function ensureVendorSupport(deps, { vendor, tenantId = null, companyId = null }) {
  const email = normEmail(vendor.email);
  let userId = await withClient(deps, async (c) => {
    const r = await c.query('SELECT id FROM auth.users WHERE lower(email) = $1 LIMIT 1', [email]);
    return r.rows[0] ? r.rows[0].id : null;
  });
  if (!userId) {
    const r = await httpJson('POST', `${deps.gotrueUrl}/admin/users`, {
      headers: { apikey: deps.serviceKey, Authorization: `Bearer ${deps.serviceKey}` },
      body: { email, password: vendor.password, email_confirm: true, user_metadata: { full_name: vendor.name || 'TexaCore Support', role: 'super_admin' },
        app_metadata: { provider: 'email', providers: ['email'] } },
    });
    if (r.status !== 200 && r.status !== 201) throw new Error(`vendor support user: ${r.status} ${JSON.stringify(r.body)}`);
    userId = r.body.id;
  }
  await withClient(deps, async (c) => {
    await c.query('BEGIN');
    try {
      await c.query(`SELECT set_config('app.is_registering', 'true', true)`);
      await c.query(
        `INSERT INTO public.user_profiles (id, email, full_name, role, tenant_id, company_id, is_active)
         VALUES ($1, $2, $3, 'super_admin', $4, $5, true)
         ON CONFLICT (id) DO UPDATE SET role = 'super_admin', tenant_id = COALESCE(EXCLUDED.tenant_id, public.user_profiles.tenant_id),
                                        company_id = COALESCE(EXCLUDED.company_id, public.user_profiles.company_id)`,
        [userId, email, vendor.name || 'TexaCore Support', tenantId, companyId]);
      await c.query(
        `INSERT INTO public.user_roles (user_id, role_id, tenant_id, company_id, is_active)
         SELECT $1, r.id, $2, $3, true FROM public.roles r WHERE r.code = 'platform_admin' AND r.tenant_id IS NULL LIMIT 1
         ON CONFLICT DO NOTHING`, [userId, tenantId, companyId]);
      await c.query(`INSERT INTO public.super_admins (user_id, email, is_active) VALUES ($1, $2, true) ON CONFLICT (user_id) DO NOTHING`, [userId, email]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; }
  });
  return userId;
}

module.exports = { createLocalCompany, healTenantOwners, ensureVendorSupport, normaliseInput, httpJson, ProvisioningError, MIN_PASSWORD_LENGTH };
