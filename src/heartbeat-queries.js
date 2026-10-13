'use strict';
// SQL the heartbeat runs against the LOCAL database to report the plan and the active modules to the cloud.
// Kept out of main.js so a check can run the very same text against the baseline schema (scripts/e2e/launch-check.js).

/**
 * Module codes of the plan the tenant is really on. `included_modules` is a text[] in the production-derived schema (the 1.x local schema had a jsonb):
 * to_jsonb() turns either into a jsonb array, so jsonb_array_elements_text() works on both. 2.0.0 called jsonb_array_elements_text(text[]) directly:
 * «function jsonb_array_elements_text(text[]) does not exist» every 3 minutes, and the cloud was told the install has no modules.
 * Pick ONE plan (LIMIT 1 on the subscription), then aggregate its modules.
 */
const ACTIVE_MODULES_SQL =
  "SELECT COALESCE((SELECT jsonb_agg(DISTINCT m ORDER BY m) FROM jsonb_array_elements_text(to_jsonb(sp.included_modules)) m), '[]'::jsonb) " +
  'FROM public.tenant_subscriptions ts JOIN public.subscription_plans sp ON sp.id=ts.plan_id ' +
  "WHERE ts.status IN ('active','trial','grace') ORDER BY ts.updated_at DESC NULLS LAST LIMIT 1;";

module.exports = { ACTIVE_MODULES_SQL };
