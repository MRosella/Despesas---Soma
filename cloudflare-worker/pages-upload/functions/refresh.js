import { corsHeaders, corsJson, tokenRequest } from './_shared.js';

export async function onRequestOptions({ env }) {
  return new Response(null, { status: 204, headers: corsHeaders(env) });
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch (e) { return corsJson({ error: 'JSON invalido' }, env, 400); }
  if (!body.refresh_token) return corsJson({ error: 'refresh_token ausente' }, env, 400);

  const params = new URLSearchParams();
  params.set('client_id', env.GOOGLE_CLIENT_ID);
  params.set('client_secret', env.GOOGLE_CLIENT_SECRET);
  params.set('refresh_token', body.refresh_token);
  params.set('grant_type', 'refresh_token');

  return await tokenRequest(params, env);
}
