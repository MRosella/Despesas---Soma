export function corsHeaders(env, extra) {
  return Object.assign({
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }, extra || {});
}

export function corsJson(obj, env, status) {
  return new Response(JSON.stringify(obj), { status, headers: corsHeaders(env, { 'Content-Type': 'application/json' }) });
}

export async function tokenRequest(params, env) {
  let r, data;
  try {
    r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    data = await r.json();
  } catch (e) {
    return corsJson({ error: 'Falha ao contatar o Google: ' + e.message }, env, 502);
  }
  if (!r.ok) return corsJson({ error: data.error_description || data.error || ('Google ' + r.status) }, env, r.status);
  return corsJson(data, env, 200);
}
