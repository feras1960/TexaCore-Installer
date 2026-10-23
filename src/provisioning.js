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
    // 1. What hangs off THIS user id. Production's role guards refuse a cascade delete coming from GoTrue's session (no JWT claims, not a
    //    trusted maintenance role) — GoTrue answers 500 "unrecognized write context" if the user holds a role row — so those rows go first,
    //    from the installer's own maintenance session, scoped to the id we created.
    await withClient(deps, async (c) => {
      await c.query('BEGIN');
      try {
        await c.query(`SELECT set_config('app.is_registering', 'true', true)`);
        await c.query('DELETE FROM public.user_role_assignments WHERE user_id = $1', [created.userId]);
        await c.query('DELETE FROM public.user_roles WHERE user_id = $1', [created.userId]);
        await c.query('DELETE FROM public.user_profiles WHERE id = $1', [created.userId]);
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); log(`[Provision] cleanup: profile rows of ${created.userId} not removed: ${e.message}`); }
    });
    // 2. the auth user itself (admin API, by the id we were handed)
    const r = await httpJson('DELETE', `${deps.gotrueUrl}/admin/users/${created.userId}`, {
      headers: { apikey: deps.serviceKey, Authorization: `Bearer ${deps.serviceKey}` },
    });
    log(`[Provision] cleanup: auth user ${created.userId} → ${r.status}`);
    if (r.status >= 300) {   // still there? remove exactly that row — by id, never by email
      await withClient(deps, async (c) => { await c.query('DELETE FROM auth.users WHERE id = $1', [created.userId]); });
      log(`[Provision] cleanup: auth user ${created.userId} removed directly`);
    }
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


// ════════════════════════════════════════════════════════════════
// Local employee invites — the local admin, ON THE MACHINE ITSELF, adds an employee (email, name, role, company).
//
// The cloud's invite path (supabase/functions/invite-user) is: GoTrue admin createUser (email confirmed, tenant/company in app_metadata — the
// trigger writes the profile) → fn_membership_invite_create AS THE INVITER → the invitee accepts (fn_membership_invite_accept → _apply: tenant
// membership, roles through fn_settings_set_user_roles, resources). This does exactly those calls, with every guard the server has
// (fn_settings_actor_may_manage, fn_can_grant_role, cross-tenant, plan limit). The two things the cloud gets from e-mail are replaced:
//   * the inviter's session — a real GoTrue session for the tenant OWNER, obtained with the service key (admin generate_link → verify);
//     the service key never leaves this process;
//   * the invitee's acceptance — the admin is physically creating the account on this machine, so the new account accepts at once, with a
//     one-time password the admin hands over (shown once, never logged). Signup stays off.
// max_users: checked against the PLAN (check_plan_limits('users'), any plan type — the database trigger only enforces the free plan).
// ════════════════════════════════════════════════════════════════
const OTP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
function generateOneTimePassword() {
  const pick = () => OTP_ALPHABET[crypto.randomInt(OTP_ALPHABET.length)];
  return [4, 4, 4].map((n) => Array.from({ length: n }, pick).join('')).join('-');
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normaliseEmployeeInput(data) {
  const d = data || {};
  const errors = [];
  const companyId = String(d.companyId || '').trim();
  if (!UUID_RE.test(companyId)) errors.push('companyId is required');
  const roleId = String(d.roleId || '').trim();
  if (!UUID_RE.test(roleId)) errors.push('roleId is required');
  const email = normEmail(d.email);
  if (!email || !EMAIL_RE.test(email) || email.length > 254) errors.push('a valid email is required');
  const fullName = String(d.fullName || '').trim().slice(0, 120);
  if (!fullName) errors.push('fullName is required');
  return { ok: errors.length === 0, errors, value: { companyId, roleId, email, fullName } };
}

/** Roles the tenant owner may grant in this company (the server's own fn_can_grant_role decides). */
async function listGrantableRoles(deps, companyId) {
  if (!UUID_RE.test(String(companyId || ''))) return { success: false, code: 'BAD_REQUEST', error: 'companyId is required' };
  return withClient(deps, async (c) => {
    const co = await c.query(`SELECT c.tenant_id, t.owner_email FROM public.companies c JOIN public.tenants t ON t.id = c.tenant_id WHERE c.id = $1`, [companyId]);
    if (!co.rowCount) return { success: false, code: 'COMPANY_NOT_FOUND', error: 'company not found' };
    const owner = await c.query(`SELECT id FROM auth.users WHERE lower(email) = lower($1) LIMIT 1`, [co.rows[0].owner_email || '']);
    if (!owner.rowCount) return { success: false, code: 'OWNER_NOT_FOUND', error: 'this tenant has no owner account' };
    const roles = await c.query(
      `SELECT r.id, r.code, r.name_ar, r.name_en FROM public.roles r
        WHERE (r.tenant_id IS NULL OR r.tenant_id = $1) AND NOT COALESCE(r.is_super_admin, false)
          AND public.fn_can_grant_role($2, r.id, $3, $1)
        ORDER BY r.name_en NULLS LAST, r.code`, [co.rows[0].tenant_id, owner.rows[0].id, companyId]);
    return { success: true, roles: roles.rows };
  });
}

async function gotrueSessionFor(deps, email) {
  const admin = { apikey: deps.serviceKey, Authorization: `Bearer ${deps.serviceKey}` };
  const gl = await httpJson('POST', `${deps.gotrueUrl}/admin/generate_link`, { headers: admin, body: { type: 'magiclink', email } });
  const hashed = gl.body && gl.body.hashed_token;
  if (gl.status !== 200 || !hashed) throw new ProvisioningError('OWNER_SESSION_FAILED', `could not open the owner's session (${gl.status})`);
  for (const type of ['magiclink', 'email']) {
    const v = await httpJson('POST', `${deps.gotrueUrl}/verify`, { headers: { apikey: deps.anonKey }, body: { type, token_hash: hashed } });
    if (v.status === 200 && v.body && v.body.access_token) return v.body.access_token;
  }
  throw new ProvisioningError('OWNER_SESSION_FAILED', "could not verify the owner's session");
}

/**
 * Undo what ONE invite call created: cancel the still-pending requests whose ids THIS call was handed, then (only when this call created the account)
 * remove that account by id. Never a lookup by e-mail, never a list.
 */
async function cleanupInvited(deps, { userId, requestIds }, log) {
  const ids = (Array.isArray(requestIds) ? requestIds : []).filter((x) => UUID_RE.test(String(x || '')));
  if (ids.length) {
    await withClient(deps, async (c) => { await c.query(`UPDATE public.company_membership_requests SET status = 'cancelled', updated_at = now() WHERE id = ANY($1::uuid[]) AND status = 'pending'`, [ids]); });
  }
  if (!userId) return;
  await withClient(deps, async (c) => {
    await c.query('BEGIN');
    try {
      await c.query(`SELECT set_config('app.is_registering', 'true', true)`);
      for (const [tbl, col] of [['user_resource_access', 'user_id'], ['user_role_assignments', 'user_id'], ['user_roles', 'user_id'], ['tenant_users', 'user_id'], ['in_app_notifications', 'user_id'], ['user_profiles', 'id']]) {
        await c.query(`DELETE FROM public.${tbl} WHERE ${col} = $1`, [userId]);
      }
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); log(`[Employee] cleanup: rows of ${userId} not removed: ${e.message}`); }
  });
  const r = await httpJson('DELETE', `${deps.gotrueUrl}/admin/users/${userId}`, { headers: { apikey: deps.serviceKey, Authorization: `Bearer ${deps.serviceKey}` } });
  if (r.status >= 300) await withClient(deps, async (c) => { await c.query('DELETE FROM auth.users WHERE id = $1', [userId]); });
  log(`[Employee] cleanup: ${userId} removed`);
}
async function cleanupEmployee(deps, { userId, requestId }, log) {
  return cleanupInvited(deps, { userId, requestIds: requestId ? [requestId] : [] }, log);
}

/**
 * Add an employee. deps: as createLocalCompany. Returns { success:true, userId, email, oneTimePassword, companyId, companyName, role, loginCode } or
 * { success:false, code, error } (never throws for expected failures). The password appears only in this return value.
 */
async function inviteLocalEmployee(deps, rawInput) {
  const log = deps.log || (() => {});
  const norm = normaliseEmployeeInput(rawInput);
  if (!norm.ok) return { success: false, code: 'BAD_REQUEST', error: norm.errors.join('; ') };
  const v = norm.value;
  const created = { userId: null, requestId: null };
  try {
    // 1. company, tenant, owner, role — and every refusal that needs no write
    const ctx = await withClient(deps, async (c) => {
      const co = await c.query(
        `SELECT c.id, c.name, c.tenant_id, COALESCE(c.status, '') AS status, t.owner_email
           FROM public.companies c JOIN public.tenants t ON t.id = c.tenant_id WHERE c.id = $1`, [v.companyId]);
      if (!co.rowCount) return { error: { code: 'COMPANY_NOT_FOUND', error: 'company not found' } };
      const row = co.rows[0];
      if (['failed', 'cancelled', 'deleted', 'provisioning'].includes(row.status)) return { error: { code: 'COMPANY_NOT_READY', error: `the company is ${row.status}` } };
      const owner = await c.query(`SELECT id, email FROM auth.users WHERE lower(email) = lower($1) LIMIT 1`, [row.owner_email || '']);
      if (!owner.rowCount) return { error: { code: 'OWNER_NOT_FOUND', error: 'this tenant has no owner account' } };
      const role = await c.query(`SELECT id, code, name_ar, name_en FROM public.roles WHERE id = $1 AND NOT COALESCE(is_super_admin, false) AND (tenant_id IS NULL OR tenant_id = $2)`, [v.roleId, row.tenant_id]);
      if (!role.rowCount) return { error: { code: 'ROLE_NOT_FOUND', error: 'role not found' } };
      if (await emailExists(c, v.email)) return { error: { code: 'EMAIL_EXISTS', error: 'This email is already registered on this computer.' } };
      const lim = await c.query(`SELECT public.check_plan_limits($1::uuid, 'users') AS r`, [row.tenant_id]);
      const r = lim.rows[0].r || {};
      if (r.allowed === false && !['no_active_subscription', 'plan_not_found'].includes(r.error || '')) {
        return { error: { code: 'PLAN_LIMIT_EXCEEDED', error: `PLAN_LIMIT_EXCEEDED: users (${r.current ?? '?'}/${r.max ?? '?'})`, current: r.current, max: r.max, plan: r.plan_code } };
      }
      return { company: row, owner: owner.rows[0], role: role.rows[0] };
    });
    if (ctx.error) return { success: false, ...ctx.error };

    // 2. the inviter's session (the tenant owner) — a real GoTrue session, from the service key
    const ownerToken = await gotrueSessionFor(deps, ctx.owner.email);

    // 3. the account (same call and metadata as the cloud's invite-user)
    const password = generateOneTimePassword();
    const create = await httpJson('POST', `${deps.gotrueUrl}/admin/users`, {
      headers: { apikey: deps.serviceKey, Authorization: `Bearer ${deps.serviceKey}` },
      body: {
        email: v.email, password, email_confirm: true,
        user_metadata: { full_name: v.fullName, invited_by: ctx.owner.id, tenant_id: ctx.company.tenant_id, company_id: v.companyId },
        app_metadata: { provider: 'email', providers: ['email'], tenant_id: ctx.company.tenant_id, company_id: v.companyId },
      },
    });
    if (create.status !== 200 && create.status !== 201) {
      const ec = create.body && (create.body.error_code || create.body.code);
      if (ec === 'email_exists' || create.status === 422) return { success: false, code: 'EMAIL_EXISTS', error: 'This email is already registered on this computer.' };
      // handle_new_user runs inside GoTrue: the free plan's user trigger surfaces here as a generic database error
      const msg = JSON.stringify(create.body || '');
      if (/PLAN_LIMIT_EXCEEDED|Database error creating new user/i.test(msg)) return { success: false, code: 'PLAN_LIMIT_EXCEEDED', error: 'PLAN_LIMIT_EXCEEDED: users', hint: msg.slice(0, 200) };
      return { success: false, code: 'AUTH_USER_FAILED', error: `Could not create the sign-in account (${create.status}): ${msg.slice(0, 300)}` };
    }
    created.userId = create.body.id;

    // 4. the invitation, as the owner — the server checks every guard (may-manage, may-grant-role, cross-tenant, already-member …)
    const rpcAs = (token, fn, args) => httpJson('POST', `${deps.restUrl}/rpc/${fn}`, { headers: { apikey: deps.anonKey, Authorization: `Bearer ${token}` }, body: args });
    const inv = await rpcAs(ownerToken, 'fn_membership_invite_create', {
      p_company_id: v.companyId, p_email: v.email, p_role_ids: [v.roleId], p_note: null, p_payload: { full_name: v.fullName },
    });
    if (inv.status !== 200 || !inv.body || inv.body.ok !== true || !inv.body.token) {
      throw new ProvisioningError('INVITE_REFUSED', `the server refused the invitation: ${(inv.body && (inv.body.reason || inv.body.message)) || inv.status}`);
    }
    created.requestId = inv.body.request_id;

    // 5. the new account accepts (the server applies membership, role and resources exactly as for a cloud acceptance)
    const si = await httpJson('POST', `${deps.gotrueUrl}/token?grant_type=password`, { headers: { apikey: deps.anonKey }, body: { email: v.email, password } });
    if (si.status !== 200 || !si.body || !si.body.access_token) throw new ProvisioningError('EMPLOYEE_SIGN_IN_FAILED', `the new account could not sign in (${si.status})`);
    const acc = await rpcAs(si.body.access_token, 'fn_membership_invite_accept', { p_token: inv.body.token });
    if (acc.status !== 200 || !acc.body || acc.body.ok !== true) {
      throw new ProvisioningError('INVITE_NOT_APPLIED', `the server did not apply the membership: ${(acc.body && (acc.body.reason || acc.body.message)) || acc.status}`);
    }
    log(`[Employee] ${v.email} added to company ${v.companyId} as ${ctx.role.code}`);   // never the password
    return {
      success: true, userId: created.userId, email: v.email, fullName: v.fullName, oneTimePassword: password,
      companyId: v.companyId, companyName: ctx.company.name, role: { id: ctx.role.id, code: ctx.role.code, name_ar: ctx.role.name_ar, name_en: ctx.role.name_en },
      loginCode: v.companyId.split('-')[0],
    };
  } catch (err) {
    log(`[Employee] failed: ${err.message}`);
    try { await cleanupEmployee(deps, created, log); } catch (e) { log(`[Employee] cleanup failed: ${e.message}`); }
    return { success: false, code: err.code || 'INVITE_FAILED', error: err.message };
  }
}

// ════════════════════════════════════════════════════════════════
// 2.0.5 RC2 — the local «دعوة مستخدم» for a SIGNED-IN manager (not "the owner, on the machine itself").
//
// inviteLocalEmployee above runs as the tenant OWNER, obtained with the service key, for the launcher's own form. The ERP's «إضافة مستخدم» screen
// is used by whoever is signed in to the ERP - a tenant admin, a company admin - from this computer, a LAN PC or the tunnel. So here the invitation is
// made AS THE CALLER, with the caller's own GoTrue token against PostgREST: every guard the cloud's invite-user relies on runs for HIM
// (fn_settings_actor_may_manage, fn_membership_invite_multi's tenant / may-manage-members / may-grant-role checks). Only two things are done with the
// installer's own powers, exactly as for the owner flow: creating the account (GoTrue admin API; there is no e-mail to send a link by) and reading
// the plan limit. A NEW account accepts every invitation at once with a one-time password that is returned once and never logged.
// Server contract: POST /local-api/invite-user (src/local-invite-route.js).
// ════════════════════════════════════════════════════════════════
const COMPANIES_PER_INVITE = 20;
const ROLES_PER_COMPANY = 20;

/** The body of POST /local-api/invite-user → a normalised value, or { ok:false, reason, error }. Unknown fields are dropped. */
function normaliseCallerInviteInput(data) {
  const d = data && typeof data === 'object' ? data : {};
  const bad = (reason, error) => ({ ok: false, reason, error, errors: [error] });
  const email = normEmail(d.email);
  if (!email || !EMAIL_RE.test(email) || email.length > 254) return bad('email', 'a valid email is required');
  const fullName = String(d.full_name == null ? '' : d.full_name).trim().slice(0, 120);
  if (!fullName) return bad('full_name', 'full_name is required');
  let phone = '';
  if (d.phone != null && d.phone !== '') {
    phone = String(d.phone).trim();
    if (!/^[0-9+()\-\s.]{3,40}$/.test(phone)) return bad('phone', 'phone is not valid');
  }
  let employeeId = null;
  if (d.employee_id != null && d.employee_id !== '') {
    employeeId = String(d.employee_id).trim();
    if (!UUID_RE.test(employeeId)) return bad('employee_id', 'employee_id must be a uuid');
  }
  let note = null;
  if (d.note != null && d.note !== '') {
    if (typeof d.note !== 'string') return bad('note', 'note must be text');
    note = d.note.trim().slice(0, 500) || null;
  }
  if (!Array.isArray(d.items) || d.items.length === 0) return bad('items', 'items must be a non-empty list');
  if (d.items.length > COMPANIES_PER_INVITE) return bad('items', `at most ${COMPANIES_PER_INVITE} companies per invitation`);
  const seen = new Set();
  const items = [];
  for (const it of d.items) {
    const companyId = it && typeof it.company_id === 'string' ? it.company_id.trim().toLowerCase() : '';
    if (!UUID_RE.test(companyId)) return bad('items', 'every item needs a company_id (uuid)');
    if (seen.has(companyId)) return bad('items', 'a company appears twice');
    seen.add(companyId);
    const roles = it && Array.isArray(it.role_ids) ? it.role_ids : null;
    if (!roles || roles.length === 0 || roles.length > ROLES_PER_COMPANY || roles.some((r) => typeof r !== 'string' || !UUID_RE.test(r.trim()))) {
      return bad('items', `every item needs 1..${ROLES_PER_COMPANY} role_ids (uuid)`);
    }
    items.push({ company_id: companyId, role_ids: [...new Set(roles.map((r) => r.trim().toLowerCase()))] });
  }
  if (employeeId && items.length !== 1) return bad('employee_id', 'employee_id can be linked only when exactly one company is invited');
  return { ok: true, value: { email, fullName, phone, employeeId, note, items } };
}

const NETWORK_ERRORS = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'EPIPE', 'ENOTFOUND']);
function servicesDown(e) { return !!e && (NETWORK_ERRORS.has(e.code) || /timeout calling|connect ECONN|Connection terminated|the database system/i.test(String(e.message || ''))); }

/**
 * Who is calling? The caller's own GoTrue access token, checked by GoTrue itself (GET /user): a missing, malformed, expired, revoked or anon/service key is
 * refused. Returns { ok:true, id, email } | { ok:false, code:'AUTH_REQUIRED' | 'SERVICES_DOWN', error }. The token is never logged.
 */
async function authenticateCaller(deps, token) {
  const t = typeof token === 'string' ? token.trim() : '';
  if (!/^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/.test(t) || t.length > 4096) return { ok: false, code: 'AUTH_REQUIRED', error: 'sign in first' };
  let r;
  try { r = await httpJson('GET', `${deps.gotrueUrl}/user`, { headers: { apikey: deps.anonKey, Authorization: `Bearer ${t}` } }); }
  catch (e) { return servicesDown(e) ? { ok: false, code: 'SERVICES_DOWN', error: 'the sign-in service is not running' } : { ok: false, code: 'AUTH_REQUIRED', error: 'sign in first' }; }
  if (r.status >= 500) return { ok: false, code: 'SERVICES_DOWN', error: 'the sign-in service is not available' };
  const u = r.body && typeof r.body === 'object' ? r.body : null;
  if (r.status !== 200 || !u || !UUID_RE.test(String(u.id || '')) || u.is_anonymous === true) return { ok: false, code: 'AUTH_REQUIRED', error: 'the session is not valid or has expired' };
  return { ok: true, id: String(u.id), email: normEmail(u.email) };
}

const RPC_REFUSALS = {
  not_allowed: ['NOT_ALLOWED', 'not allowed to add users to this company'],
  cross_tenant: ['NOT_ALLOWED', 'this company belongs to another tenant'],
  role_not_grantable: ['ROLE_NOT_GRANTABLE', 'one of the roles cannot be granted by you'],
  bad_request: ['BAD_REQUEST', 'the invitation is not valid'],
  company_not_found: ['BAD_REQUEST', 'company not found'],
  not_authenticated: ['AUTH_REQUIRED', 'the session is not valid or has expired'],
};
/** A PostgREST error answer of an invite function → our failure object (the server's own reason word is kept as `reason`). */
function inviteRpcFailure(res, fallback = 'INVITE_FAILED') {
  const b = res && res.body && typeof res.body === 'object' ? res.body : {};
  const msg = String(b.message || b.reason || '').trim();
  const key = msg.toLowerCase();
  if (res && (res.status === 401 || b.code === 'PGRST301' || b.code === 'PGRST303' || /jwt/i.test(msg))) return { success: false, code: 'AUTH_REQUIRED', reason: 'jwt', error: RPC_REFUSALS.not_authenticated[1] };
  if (RPC_REFUSALS[key]) {
    const out = { success: false, code: RPC_REFUSALS[key][0], reason: key, error: RPC_REFUSALS[key][1] };
    const det = typeof b.details === 'string' ? b.details.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) : null;
    if (det) out.company_id = det[0];
    return out;
  }
  const reason = /^[a-z0-9_]{1,60}$/i.test(key) ? key : 'refused';
  return { success: false, code: fallback, reason, error: `the server refused the invitation (${reason})` };
}

/**
 * Invite (and, for a new account, create and activate) a user into one or more companies AS THE SIGNED-IN CALLER.
 * rawInput: { callerToken, caller?, email, full_name, phone?, employee_id?, items:[{company_id, role_ids[]}], note? }   (caller = result of authenticateCaller)
 * Returns { success:true, data:{ user_id, email, is_new, one_time_password?, created, skipped, request_ids, accepted, companies } } or
 * { success:false, code, reason?, error, current?, max? } - never throws for expected failures. The password appears only in this return value.
 */
async function inviteLocalUserAsCaller(deps, rawInput) {
  const log = deps.log || (() => {});
  const norm = normaliseCallerInviteInput(rawInput);
  if (!norm.ok) return { success: false, code: 'BAD_REQUEST', reason: norm.reason, error: norm.error };
  const v = norm.value;
  const callerToken = rawInput && typeof rawInput.callerToken === 'string' ? rawInput.callerToken.trim() : '';
  const created = { userId: null, requestIds: [] };
  try {
    // 1. who is calling (GoTrue vouches for the token)
    const caller = (rawInput && rawInput.caller && rawInput.caller.ok) ? rawInput.caller : await authenticateCaller(deps, callerToken);
    if (!caller.ok) return { success: false, code: caller.code, error: caller.error };
    const rpcAs = (token, fn, args) => httpJson('POST', `${deps.restUrl}/rpc/${fn}`, { headers: { apikey: deps.anonKey, Authorization: `Bearer ${token}` }, body: args });

    // 2. authorise, with the CALLER's own token: may he manage each company, and does the multi-company function (tenant, may-manage-members, may-grant-role) accept it
    for (const it of v.items) {
      const may = await rpcAs(callerToken, 'fn_settings_actor_may_manage', { p_actor: caller.id, p_company: it.company_id });
      if (may.status === 401 || (may.body && typeof may.body === 'object' && (may.body.code === 'PGRST301' || may.body.code === 'PGRST303'))) return { success: false, code: 'AUTH_REQUIRED', error: RPC_REFUSALS.not_authenticated[1] };
      if (may.status >= 500) throw Object.assign(new Error(`the server could not check the permission (${may.status})`), { code: 'RPC_UNAVAILABLE' });
      if (may.status !== 200 || may.body !== true) return { success: false, code: 'NOT_ALLOWED', reason: 'not_allowed', company_id: it.company_id, error: RPC_REFUSALS.not_allowed[1] };
    }
    const dry = await rpcAs(callerToken, 'fn_membership_invite_multi', { p_email: v.email, p_items: v.items, p_note: v.note, p_request_key: null, p_dry_run: true });
    if (dry.status !== 200) {
      if (dry.status >= 500) throw Object.assign(new Error(`the server could not check the invitation (${dry.status})`), { code: 'RPC_UNAVAILABLE' });
      return inviteRpcFailure(dry);
    }

    // 3. the companies' tenant (one), whether the account exists, and - only when a NEW account would be created - the plan limit
    const ctx = await withClient(deps, async (c) => {
      const co = await c.query('SELECT id, name, tenant_id FROM public.companies WHERE id = ANY($1::uuid[])', [v.items.map((i) => i.company_id)]);
      if (co.rowCount !== v.items.length) return { error: { code: 'BAD_REQUEST', reason: 'company_not_found', error: RPC_REFUSALS.company_not_found[1] } };
      const tenants = [...new Set(co.rows.map((r) => r.tenant_id))];
      if (tenants.length !== 1) return { error: { code: 'BAD_REQUEST', reason: 'mixed_tenants', error: 'all companies of one invitation must belong to the same tenant' } };
      const ex = await c.query('SELECT id FROM auth.users WHERE lower(email) = $1 LIMIT 1', [v.email]);
      const isNew = ex.rowCount === 0;
      if (isNew) {
        const lim = await c.query(`SELECT public.check_plan_limits($1::uuid, 'users') AS r`, [tenants[0]]);
        const r = lim.rows[0].r || {};
        if (r.allowed === false && !['no_active_subscription', 'plan_not_found'].includes(r.error || '')) {
          return { error: { code: 'PLAN_LIMIT_EXCEEDED', error: `PLAN_LIMIT_EXCEEDED: users (${r.current ?? '?'}/${r.max ?? '?'})`, current: r.current, max: r.max } };
        }
      }
      return { tenantId: tenants[0], isNew, existingId: isNew ? null : ex.rows[0].id, names: new Map(co.rows.map((r) => [r.id, r.name])) };
    });
    if (ctx.error) return { success: false, ...ctx.error };

    // 4. a NEW account: same GoTrue admin call and metadata as inviteLocalEmployee (the trigger on auth.users writes the profile)
    let password = null;
    if (ctx.isNew) {
      password = generateOneTimePassword();
      const create = await httpJson('POST', `${deps.gotrueUrl}/admin/users`, {
        headers: { apikey: deps.serviceKey, Authorization: `Bearer ${deps.serviceKey}` },
        body: {
          email: v.email, password, email_confirm: true,
          user_metadata: { full_name: v.fullName, invited_by: caller.id, tenant_id: ctx.tenantId, company_id: v.items[0].company_id, ...(v.phone ? { phone: v.phone } : {}) },
          app_metadata: { provider: 'email', providers: ['email'], tenant_id: ctx.tenantId, company_id: v.items[0].company_id },
        },
      });
      if (create.status !== 200 && create.status !== 201) {
        const ec = create.body && (create.body.error_code || create.body.code);
        if (ec === 'email_exists' || create.status === 422) return { success: false, code: 'INVITE_FAILED', reason: 'email_exists', error: 'This email was registered on this computer a moment ago. Try again.' };
        const msg = JSON.stringify(create.body || '');
        if (/PLAN_LIMIT_EXCEEDED|Database error creating new user/i.test(msg)) return { success: false, code: 'PLAN_LIMIT_EXCEEDED', error: 'PLAN_LIMIT_EXCEEDED: users' };
        return { success: false, code: 'INVITE_FAILED', reason: 'account_create_failed', error: `Could not create the sign-in account (${create.status})` };
      }
      created.userId = create.body.id;
    }

    // 5. the invitation(s), AS THE CALLER - the server applies every guard again for the real write
    let outcome;
    if (v.employeeId) {
      // the multi-company function carries no payload; a single company with an employee record goes through the single-company function (it validates the employee)
      const it = v.items[0];
      const one = await rpcAs(callerToken, 'fn_membership_invite_create', { p_company_id: it.company_id, p_email: v.email, p_role_ids: it.role_ids, p_note: v.note, p_payload: { full_name: v.fullName, employee_id: v.employeeId } });
      if (one.status !== 200 || !one.body || one.body.ok !== true || !one.body.request_id) {
        const f = one.status !== 200 ? inviteRpcFailure(one) : { success: false, code: 'INVITE_FAILED', reason: String((one.body && one.body.reason) || 'refused').replace(/[^a-z0-9_]/gi, '').slice(0, 60) || 'refused' };
        throw Object.assign(new Error(f.error || `the server refused the invitation (${f.reason})`), { failure: { ...f, error: f.error || `the server refused the invitation (${f.reason})` } });
      }
      outcome = { created: 1, skipped: [], request_ids: [one.body.request_id] };
    } else {
      const real = await rpcAs(callerToken, 'fn_membership_invite_multi', { p_email: v.email, p_items: v.items, p_note: v.note, p_request_key: `local-invite:${crypto.randomUUID()}`, p_dry_run: false });
      if (real.status !== 200 || !real.body || real.body.ok !== true) {
        const f = inviteRpcFailure(real);
        throw Object.assign(new Error(f.error), { failure: f });
      }
      outcome = { created: Number(real.body.created) || 0, skipped: Array.isArray(real.body.skipped) ? real.body.skipped.map((x) => ({ company_id: x && x.company_id, reason: x && x.reason })) : [], request_ids: Array.isArray(real.body.request_ids) ? real.body.request_ids.filter((x) => UUID_RE.test(String(x))) : [] };
    }
    created.requestIds = outcome.request_ids.slice();

    // 6. a NEW account accepts every invitation at once (the identity guard of the respond function is the account itself)
    let accepted = 0;
    if (ctx.isNew && outcome.request_ids.length) {
      const si = await httpJson('POST', `${deps.gotrueUrl}/token?grant_type=password`, { headers: { apikey: deps.anonKey }, body: { email: v.email, password } });
      if (si.status !== 200 || !si.body || !si.body.access_token) throw new ProvisioningError('EMPLOYEE_SIGN_IN_FAILED', `the new account could not sign in (${si.status})`);
      for (const rid of outcome.request_ids) {
        const acc = await rpcAs(si.body.access_token, 'fn_membership_invite_respond', { p_request_id: rid, p_accept: true });
        if (acc.status !== 200 || !acc.body || acc.body.ok !== true) {
          throw new ProvisioningError('INVITE_NOT_APPLIED', `the server did not apply the membership: ${(acc.body && (acc.body.reason || acc.body.message)) || acc.status}`);
        }
        accepted += 1;
      }
    }

    const userId = ctx.isNew ? created.userId : ctx.existingId;
    log(`[Invite] ${ctx.isNew ? 'new account' : 'existing account'} ${userId} invited by ${caller.id} to ${v.items.length} company(ies): ${outcome.created} created, ${accepted} accepted`);   // never the password or a token
    return {
      success: true,
      data: {
        user_id: userId, email: v.email, is_new: ctx.isNew,
        ...(ctx.isNew ? { one_time_password: password } : {}),
        created: outcome.created, skipped: outcome.skipped, request_ids: outcome.request_ids, accepted,
        companies: v.items.map((i) => ({ company_id: i.company_id, company_name: ctx.names.get(i.company_id) || '', login_code: i.company_id.split('-')[0] })),
      },
    };
  } catch (err) {
    log(`[Invite] failed: ${err.failure ? err.failure.code : (err.code || 'error')}`);   // (the message may name a server reason, never a secret)
    if (created.userId || created.requestIds.length) {
      try { await cleanupInvited(deps, created, log); } catch (e) { log(`[Invite] cleanup failed: ${e.message}`); }
    }
    if (err.failure) return err.failure;
    if (servicesDown(err) || err.code === 'RPC_UNAVAILABLE') return { success: false, code: 'SERVICES_DOWN', error: 'the services are not available' };
    return { success: false, code: 'INVITE_FAILED', reason: String(err.code || 'error').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40) || 'error', error: err instanceof ProvisioningError ? String(err.message).slice(0, 200) : 'the invitation failed' };
  }
}

module.exports = {
  createLocalCompany, healTenantOwners, ensureVendorSupport, normaliseInput, httpJson, ProvisioningError, MIN_PASSWORD_LENGTH,
  inviteLocalEmployee, listGrantableRoles, normaliseEmployeeInput, generateOneTimePassword,
  inviteLocalUserAsCaller, authenticateCaller, normaliseCallerInviteInput, inviteRpcFailure, cleanupInvited,
};
