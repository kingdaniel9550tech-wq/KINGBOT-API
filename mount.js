// Connects the modules' plain route definitions to Express: key checks, CORS for public routes, rate limits, streaming.
const { limiter } = require('./util');

function corsHeaders(req, allowed) {
  const origin = req.headers?.origin;
  const h = { 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '600' };
  if (allowed.includes('*')) h['Access-Control-Allow-Origin'] = '*';
  else if (origin && allowed.includes(origin)) { h['Access-Control-Allow-Origin'] = origin; h.Vary = 'Origin'; }
  return h;
}

function send(res, out = {}) {
  if (out.headers) for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
  res.status(out.status || 200);
  if (out.stream) {
    out.stream.on('error', () => { try { res.destroy(); } catch {} });
    res.on('close', () => { try { out.stream.destroy(); } catch {} });
    out.stream.pipe(res);
    return;
  }
  if (out.body !== undefined) {
    if (out.contentType) res.setHeader('Content-Type', out.contentType);
    return res.send(out.body);
  }
  return res.json(out.json ?? {});
}

/**
 * routes: [{ method: 'get'|['get','post'], path, access: 'key'|'public', limit?: false, handler(ctx) }]
 * handler returns { json } | { body, contentType } | { stream, headers, status }
 */
function mount(app, routes, { env = process.env } = {}) {
  const allowed = String(env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean);
  const publicAllow = limiter(Number(env.PUBLIC_RATE ?? 60), 60_000);

  for (const r of routes) {
    const methods = Array.isArray(r.method) ? r.method : [r.method];
    const isPublic = r.access === 'public';
    const run = async (req, res) => {
      if (isPublic) for (const [k, v] of Object.entries(corsHeaders(req, allowed))) res.setHeader(k, v);
      if (!isPublic && !req.apiKey) return res.status(401).json({ error: 'Invalid API key' });
      if (isPublic && r.limit !== false && !publicAllow(req.ip || 'unknown')) return res.status(429).json({ error: 'Too many requests, slow down' });
      const ctx = {
        query: req.query || {},
        body: req.body && typeof req.body === 'object' ? req.body : {},
        params: req.params || {},
        headers: req.headers || {},
        ip: req.ip,
        req,
        hasKey: !!req.apiKey,
        base: env.PUBLIC_BASE_URL || `${req.protocol || 'https'}://${(req.get && req.get('host')) || req.headers?.host}`,
      };
      try {
        send(res, await r.handler(ctx));
      } catch (e) {
        if (!res.headersSent) res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong' });
        if (!e.status) console.error('[route error]', r.path, e.message);
      }
    };
    for (const m of methods) app[m](r.path, run);
    if (isPublic) app.options(r.path, (req, res) => { for (const [k, v] of Object.entries(corsHeaders(req, allowed))) res.setHeader(k, v); res.status(204).end(); });
  }
}

module.exports = mount;
module.exports.send = send;
