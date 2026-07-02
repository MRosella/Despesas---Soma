import { corsHeaders, corsJson, tokenRequest } from './_shared.js';

export async function onRequestOptions({ env }) {
  return new Response(null, { status: 204, headers: corsHeaders(env) });
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch (e) { return corsJson({ error: 'JSON invalido' }, env, 400); }
  if (!body.code) return corsJson({ error: 'code ausente' }, env, 400);

  const params = new URLSearchParams();
  params.set('client_id', env.GOOGLE_CLIENT_ID);
  params.set('client_secret', env.GOOGLE_CLIENT_SECRET);
  params.set('code', body.code);
  params.set('grant_type', 'authorization_code');
  params.set('redirect_uri', body.redirect_uri || env.ALLOWED_ORIGIN || '');

  return await tokenRequest(params, env);
}
