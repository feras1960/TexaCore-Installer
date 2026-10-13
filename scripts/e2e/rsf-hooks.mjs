// Loader hooks for the Rashid import check: '@/lib/supabase' → the real supabase-js client the script builds (rsf-sbmod.mjs);
// every other '@/…' → the ERP's src tree (WT_SRC). Same idea as the ERP's own tests/rsf-lab hooks.
const HERE = new URL('.', import.meta.url).pathname;
const WT_SRC = process.env.WT_SRC;
if (!WT_SRC) throw new Error('WT_SRC is required');

export async function resolve(specifier, context, next) {
  if (specifier === '@/lib/supabase') return { url: `file://${HERE}rsf-sbmod.mjs`, shortCircuit: true };
  if (specifier.startsWith('@/')) return next(`file://${WT_SRC}/${specifier.slice(2)}`, context);
  return next(specifier, context);
}
