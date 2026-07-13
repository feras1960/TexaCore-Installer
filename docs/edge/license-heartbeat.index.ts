// ════════════════════════════════════════════════════════════════════════════
//  license-heartbeat — Supabase Edge Function  (Phase H1 update)
// ────────────────────────────────────────────────────────────────────────────
//  ⚠️ NOTE FOR THE MAINTAINER:
//  The ORIGINAL source of this function was NOT found in any local repo. It is
//  deployed to the SEPARATE licensing project:
//      https://wzkklenfsaepegymfxfz.supabase.co/functions/v1/license-heartbeat
//  (see LICENSING_URL in src/main.js). It is NOT under
//  erpsystem-supabase/supabase/functions/.
//
//  Therefore this file is a PATCH / REFERENCE, not a verbatim copy. Do NOT blindly
//  overwrite the live function with it. Apply the two clearly-marked
//  «── H1 PATCH ──» blocks below into the real function, keeping every existing
//  behaviour (REVOKED / SUSPENDED / NOT_FOUND / accepted codes, device tracking,
//  metrics upsert, etc.). The surrounding scaffolding here mirrors the observed
//  contract so the diff is obvious.
//
//  DO NOT DEPLOY from here (task = write file only).
// ════════════════════════════════════════════════════════════════════════════
//
// ┌──────────────────────────────────────────────────────────────────────────┐
// │  REQUIRED CLOUD MIGRATION (run once on the licensing project, licenses tbl)│
// │                                                                            │
// │    ALTER TABLE licenses ADD COLUMN IF NOT EXISTS current_plan text;        │
// │                                                                            │
// │  `enabled_modules` (jsonb) already exists — we additionally refresh it     │
// │  from the request's active_modules when that array is provided & non-empty.│
// └──────────────────────────────────────────────────────────────────────────┘

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json();
    const licenseKey: string | null = body.license_key ?? null;

    if (!licenseKey) {
      return new Response(JSON.stringify({ accepted: false, code: 'NO_KEY' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Look up the license row (existing behaviour) ─────────────────────────
    const { data: license } = await supabase
      .from('licenses')
      .select('*')
      .eq('license_key', licenseKey)
      .maybeSingle();

    if (!license) {
      return new Response(JSON.stringify({ accepted: false, code: 'NOT_FOUND' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ╔══════════════════════════════════════════════════════════════════════╗
    // ║  ── H1 PATCH (1/2): read the real applied state from the heartbeat ──   ║
    // ║  The installer now reports the ACTUAL locally-applied plan + modules    ║
    // ║  (not just the license tier). Persist them onto the licenses row so the ║
    // ║  cloud dashboard reflects what the device really enforces.              ║
    // ╚══════════════════════════════════════════════════════════════════════╝
    const currentPlan: string | null =
      typeof body.current_plan === 'string' && body.current_plan.trim()
        ? body.current_plan.trim()
        : null;
    const activeModules: string[] = Array.isArray(body.active_modules)
      ? body.active_modules.filter((m: unknown) => typeof m === 'string')
      : [];

    // Build the update patch for the licenses row. Keep all your existing
    // heartbeat fields (last_seen_at, app_version, hardware_id, metrics, …) and
    // MERGE these two lines in.
    const licenseUpdate: Record<string, unknown> = {
      last_seen_at: new Date().toISOString(),
      app_version: body.app_version ?? license.app_version,
      // ── H1 PATCH: real applied plan ──
      current_plan: currentPlan ?? license.current_plan ?? null,
    };
    // ── H1 PATCH: only overwrite enabled_modules when the device sent a
    //    non-empty array (an empty array means "services down / query failed" on
    //    the client and must NOT wipe the stored modules).
    if (activeModules.length > 0) {
      licenseUpdate.enabled_modules = activeModules;
    }

    await supabase
      .from('licenses')
      .update(licenseUpdate)
      .eq('license_key', licenseKey);
    // ── end H1 PATCH (1/2) ───────────────────────────────────────────────────

    // ── Enforcement / status response (existing behaviour) ───────────────────
    if (license.status === 'revoked') {
      return new Response(JSON.stringify({ accepted: false, code: 'REVOKED' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (license.status === 'suspended') {
      return new Response(JSON.stringify({ accepted: false, code: 'SUSPENDED' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Healthy beat.
    return new Response(
      JSON.stringify({
        accepted: true,
        command: 'OK',
        // Echo back so the client can reconcile if desired (optional).
        current_plan: licenseUpdate.current_plan,
        active_modules: activeModules,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ accepted: false, code: 'ERROR', error: String(err?.message ?? err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
