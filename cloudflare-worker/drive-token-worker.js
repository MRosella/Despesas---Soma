/* ============================================================
   Renovador de sessão do Google Drive (Cloudflare Worker)
   ------------------------------------------------------------
   Guarda o client_secret do Google (que NÃO pode ficar no app,
   público no GitHub Pages) e faz, em nome do app:
     POST /exchange { code, redirect_uri }      -> 1ª conexão: troca o
       código de autorização por access_token + refresh_token.
     POST /refresh  { refresh_token }           -> renova o access_token
       a qualquer momento, sem popup, sem o usuário estar presente.
   Configurar no painel da Cloudflare (Workers > este Worker > Settings
   > Variables and Secrets):
     GOOGLE_CLIENT_ID     (texto, o mesmo Client ID do app)
     GOOGLE_CLIENT_SECRET (secret, da tela de credenciais do mesmo
                           Client ID no Google Cloud Console)
     ALLOWED_ORIGIN       (texto, ex.: https://mrosella.github.io)
   ============================================================ */

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || '*';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405, cors);

    const url = new URL(request.url);
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'JSON invalido' }, 400, cors); }

    const params = new URLSearchParams();
    params.set('client_id', env.GOOGLE_CLIENT_ID);
    params.set('client_secret', env.GOOGLE_CLIENT_SECRET);

    if (url.pathname === '/exchange') {
      if (!body.code) return json({ error: 'code ausente' }, 400, cors);
      params.set('code', body.code);
      params.set('grant_type', 'authorization_code');
      params.set('redirect_uri', body.redirect_uri || origin);
    } else if (url.pathname === '/refresh') {
      if (!body.refresh_token) return json({ error: 'refresh_token ausente' }, 400, cors);
      params.set('refresh_token', body.refresh_token);
      params.set('grant_type', 'refresh_token');
    } else {
      return json({ error: 'not found' }, 404, cors);
    }

    let r, data;
    try {
      r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      data = await r.json();
    } catch (e) {
      return json({ error: 'Falha ao contatar o Google: ' + e.message }, 502, cors);
    }
    if (!r.ok) return json({ error: data.error_description || data.error || ('Google ' + r.status) }, r.status, cors);
    return json(data, 200, cors);
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
