/**
 * Download router: send ONE link (or a search text) and it finds a working source.
 *   GET|POST /download?url=<link>&type=video|audio     (needs your API key)
 *   GET      /dl/f/<token>                              the file itself, streamed (the link expires in 30 minutes)
 *   GET      /dl/platforms                              what is supported
 *
 * Sources are tried in order and a source that keeps failing is skipped for a few minutes.
 * Everything is configurable from environment variables (see README). Only public content is supported:
 * links from DRM / paid streaming services (Spotify, Netflix, Apple Music ...) are refused.
 */
const crypto = require('crypto');
const { Readable } = require('stream');
const { ttlCache, request, isPrivateHost, httpError } = require('./util');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const PLATFORMS = [
  ['youtube', /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/],
  ['tiktok', /(^|\.)tiktok\.com$/],
  ['instagram', /(^|\.)(instagram\.com|instagr\.am)$/],
  ['facebook', /(^|\.)(facebook\.com|fb\.watch|fb\.com)$/],
  ['twitter', /(^|\.)(twitter\.com|x\.com|t\.co)$/],
  ['pinterest', /(^|\.)(pinterest\.[a-z.]+|pin\.it)$/],
  ['reddit', /(^|\.)(reddit\.com|redd\.it)$/],
  ['soundcloud', /(^|\.)soundcloud\.com$/],
  ['audiomack', /(^|\.)audiomack\.com$/],
  ['threads', /(^|\.)threads\.(net|com)$/],
  ['snapchat', /(^|\.)snapchat\.com$/],
  ['twitch', /(^|\.)(twitch\.tv)$/],
  ['vimeo', /(^|\.)vimeo\.com$/],
  ['dailymotion', /(^|\.)(dailymotion\.com|dai\.ly)$/],
];
const BLOCKED = /(^|\.)(spotify\.com|music\.apple\.com|netflix\.com|primevideo\.com|disneyplus\.com|hulu\.com|hbomax\.com|max\.com|deezer\.com|tidal\.com)$/;

// Errors that say something about the link itself, so they must not make a source "rest".
const SOFT_ERRORS = new Set(['unavailable', 'unsupported', 'too_big', 'bad_url', 'format', 'bad_job', 'blocked', 'rate_limited']);

const MIME = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', opus: 'audio/ogg', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

function platformOf(hostname) {
  for (const [name, re] of PLATFORMS) if (re.test(hostname)) return name;
  return null;
}

/** Works out what the user sent: a link, or a search text. */
function detect(raw) {
  let s = String(raw || '').trim();
  if (!s) throw httpError(400, 'Send a link (url=...) or a search text (q=...).');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && !/\s/.test(s)) {
    try { if (platformOf(new URL('https://' + s).hostname.toLowerCase())) s = 'https://' + s; } catch {}
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    let u;
    try { u = new URL(s); } catch { throw httpError(400, 'That link is not valid.'); }
    if (!/^https?:$/.test(u.protocol)) throw httpError(400, 'Only http(s) links are supported.');
    const host = u.hostname.toLowerCase();
    if (isPrivateHost(host)) throw httpError(400, 'That link is not allowed.');
    if (BLOCKED.test(host)) throw httpError(400, 'That service uses protected (DRM) content, which this downloader does not support.');
    return { kind: 'url', url: u.toString(), platform: platformOf(host) || 'other' };
  }
  return { kind: 'query', query: s.slice(0, 200), platform: 'search' };
}

const extOf = (url, fallback) => {
  try { const m = new URL(url).pathname.match(/\.([a-z0-9]{2,4})$/i); if (m && MIME[m[1].toLowerCase()]) return m[1].toLowerCase(); } catch {}
  return fallback;
};
const safeName = (s) => String(s || 'download').replace(/[^\w\s.\-()]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'download';
const absolute = (u, base) => (String(u).startsWith('/') ? base + u : u);

function buildProviders(env, fetchImpl) {
  const t = Number(env.DL_TIMEOUT_MS || 40000);
  const slow = Number(env.DL_SLOW_TIMEOUT_MS || 90000);
  const get = (url, headers = {}, ms = t) => request(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, timeoutMs: ms, fetchImpl });
  const trim = (u) => String(u).replace(/\/+$/, '');
  const off = (v) => v === 'off' || v === '';

  return {
    // TikTok (no watermark). Free public API.
    tikwm: {
      enabled: () => !off(env.TIKWM_URL),
      supports: (d) => d.kind === 'url' && d.platform === 'tiktok',
      async run(d, type) {
        const base = trim(env.TIKWM_URL || 'https://www.tikwm.com');
        const j = await get(`${base}/api/?url=${encodeURIComponent(d.url)}&hd=1`);
        if (!j || j.code !== 0 || !j.data) throw new Error(j?.msg || 'no data');
        const x = j.data;
        const title = x.title || 'TikTok';
        if (type === 'audio') {
          const a = x.music || x.music_info?.play;
          if (!a) throw new Error('no audio');
          return { title, url: absolute(a, base), thumbnail: x.cover, author: x.author?.nickname, ext: 'mp3' };
        }
        if (Array.isArray(x.images) && x.images.length) return { title, thumbnail: x.cover, author: x.author?.nickname, items: x.images.map((u) => ({ type: 'image', url: u })) };
        const v = x.hdplay || x.play;
        if (!v) throw new Error('no video');
        return { title, url: absolute(v, base), thumbnail: x.cover, duration: x.duration, author: x.author?.nickname, ext: 'mp4' };
      },
    },
    // ES Teams API (YouTube by link or by name). Needs DOWNLOADER_API_KEY, the same key your bot uses.
    esteam: {
      enabled: () => !!env.DOWNLOADER_API_KEY && !off(env.ESTEAM_URL),
      supports: (d) => d.kind === 'query' || d.platform === 'youtube',
      async run(d, type) {
        const base = trim(env.ESTEAM_URL || 'https://esteamstv.devs.surf');
        const q = d.kind === 'query' ? d.query : d.url;
        const j = await get(`${base}/api/v1/dev/${type === 'audio' ? 'mp3' : 'mp4'}?query=${encodeURIComponent(q)}`, { 'x-api-key': env.DOWNLOADER_API_KEY }, slow);
        if (!j || j.error || !j.download_url) throw new Error(j?.error || 'no file');
        return { title: j.title || 'YouTube', url: j.download_url, thumbnail: j.thumbnail, ext: type === 'audio' ? 'mp3' : 'mp4' };
      },
    },
    // Cobalt (open-source downloader; covers many sites). Needs COBALT_URL (your own or a friend's instance), optional COBALT_KEY.
    cobalt: {
      enabled: () => !!env.COBALT_URL && !off(env.COBALT_URL),
      supports: (d) => d.kind === 'url',
      async run(d, type) {
        const headers = { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': UA };
        if (env.COBALT_KEY) headers.Authorization = `${env.COBALT_AUTH || 'Api-Key'} ${env.COBALT_KEY}`;
        const j = await request(trim(env.COBALT_URL) + '/', { method: 'POST', headers, timeoutMs: slow, fetchImpl, body: { url: d.url, downloadMode: type === 'audio' ? 'audio' : 'auto', videoQuality: env.COBALT_QUALITY || '720', filenameStyle: 'basic' } });
        if (j.status === 'tunnel' || j.status === 'redirect') return { title: (j.filename || 'download').replace(/\.[a-z0-9]{2,4}$/i, ''), url: j.url, ext: extOf(j.filename || j.url, type === 'audio' ? 'mp3' : 'mp4') };
        if (j.status === 'picker' && Array.isArray(j.picker) && j.picker.length) {
          return { title: 'Download', items: j.picker.map((p) => ({ type: p.type === 'photo' ? 'image' : p.type || 'video', url: p.url })), url: j.audio, ext: 'mp3' };
        }
        throw new Error(j.error?.code || j.status || 'no result');
      },
    },
    // Your own earlier KINGBOT API (search + download). Set KINGBOT_DL_URL=off to disable.
    kingbot: {
      enabled: () => !off(env.KINGBOT_DL_URL ?? 'https://kingbot-api.up.railway.app'),
      supports: (d) => d.kind === 'query' || d.kind === 'url',
      async run(d, type) {
        const base = trim(env.KINGBOT_DL_URL || 'https://kingbot-api.up.railway.app');
        let url = d.url, title, thumbnail, duration;
        if (d.kind === 'query') {
          const s = await get(`${base}/search?q=${encodeURIComponent(d.query)}`, {}, t);
          if (!s?.success || !s.url) throw new Error('nothing found');
          ({ url, title, thumbnail, duration } = s);
        }
        const r = await request(`${base}/download`, { method: 'POST', body: { url, type }, timeoutMs: slow, fetchImpl, headers: { 'User-Agent': UA } });
        if (!r?.success || !r.downloadUrl) throw new Error('no file');
        return { title: title || r.title || 'Download', url: r.downloadUrl, thumbnail, duration, ext: type === 'audio' ? 'mp3' : 'mp4' };
      },
    },
  };
}

function createDownloader({ env = process.env, fetchImpl = (...a) => fetch(...a), now = () => Date.now(), allowPrivate = false, workerHub = null } = {}) {
  const providers = buildProviders(env, fetchImpl);
  if (workerHub) providers.worker = workerHub.provider; // your own phone / PC doing the downloading with yt-dlp
  const explicit = String(env.DL_PROVIDERS || '').split(',').map((s) => s.trim()).filter(Boolean);
  // Best source first for each kind of link. YouTube goes to your own services before cobalt; everything else prefers cobalt.
  const DEFAULT_ORDER = { youtube: ['worker', 'esteam', 'kingbot', 'cobalt'], search: ['worker', 'esteam', 'kingbot'], tiktok: ['worker', 'tikwm', 'cobalt', 'kingbot'], other: ['worker', 'cobalt', 'kingbot'] };
  const orderFor = (d) => (explicit.length ? explicit : DEFAULT_ORDER[d.platform] || DEFAULT_ORDER.other);
  const order = explicit.length ? explicit : Object.keys(providers);
  const state = Object.fromEntries(Object.keys(providers).map((n) => [n, { fails: 0, until: 0 }]));
  const COOL_MS = Number(env.DL_COOLDOWN_MS || 300000);
  const results = ttlCache(Number(env.DL_CACHE_MS || 600000), 300);
  const streams = ttlCache(Number(env.DL_STREAM_TTL_MS || 1800000), 1000);
  const MAX_MB = Number(env.MAX_PROXY_MB || 200);

  async function resolve(input, type, { fresh = false, base = '' } = {}) {
    const d = detect(input);
    const cacheKey = `${type}|${d.kind === 'query' ? d.query.toLowerCase() : d.url}`;
    let found = !fresh && results.get(cacheKey);
    if (found?.local && !(workerHub && workerHub.has(found.local))) found = undefined; // the stored file is gone: fetch it again
    if (!found) {
      const errors = [];
      for (const name of orderFor(d)) {
        const p = providers[name];
        if (!p) continue;
        if (!p.enabled()) { if (name === 'worker' && workerHub?.configured()) errors.push('worker (offline: is your phone/PC running king-worker?)'); continue; }
        if (!p.supports(d)) continue;
        const st = state[name];
        if (st.until > now()) { errors.push(`${name} (resting)`); continue; }
        try {
          const r = await p.run(d, type);
          const urls = [r.url, ...(r.items || []).map((i) => i.url)].filter(Boolean);
          if (!urls.length && !r.local) throw new Error('empty answer');
          for (const u of urls) {
            let pu; try { pu = new URL(u); } catch { throw new Error('bad file link'); }
            if (!/^https?:$/.test(pu.protocol) || (!allowPrivate && isPrivateHost(pu.hostname))) throw new Error('unsafe file link');
          }
          st.fails = 0;
          found = { ...r, provider: name };
          break;
        } catch (e) {
          if (SOFT_ERRORS.has(e.code)) { errors.push(`${name}: ${e.message}`); continue; } // a problem with THIS link (private video, too big...), not with the source
          st.fails++;
          if (st.fails >= 3) { st.until = now() + COOL_MS; st.fails = 0; }
          errors.push(`${name}: ${e.message}`);
        }
      }
      if (!found) throw httpError(502, `Could not download that. ${errors.length ? 'Tried: ' + errors.join('; ') : 'No source is set up for this kind of link.'}`);
      results.set(cacheKey, found);
    }
    const ext = found.ext || (found.url ? extOf(found.url, type === 'audio' ? 'mp3' : 'mp4') : 'mp4');
    const mimeOf = (e) => MIME[e] || (type === 'audio' ? 'audio/mpeg' : 'video/mp4');
    const out = {
      ok: true, platform: d.platform, type, provider: found.provider, title: found.title, thumbnail: found.thumbnail, duration: found.duration, author: found.author,
      url: found.url, items: found.items,
    };
    if (found.url || found.local) {
      const token = crypto.randomBytes(16).toString('hex');
      const filename = `${safeName(found.title)}.${ext}`;
      streams.set(token, { url: found.url, local: found.local, filename, mime: mimeOf(ext) });
      out.filename = filename;
      out.mime = mimeOf(ext);
      out.stream = `${base}/dl/f/${token}`;
    }
    return out;
  }

  async function streamFile(token, headers = {}, query = {}) {
    const e = streams.get(token);
    if (!e) return { status: 404, json: { error: 'This download link has expired. Request it again.' } };
    if (e.local) return workerHub.open(e.local, headers.range, { filename: e.filename, mime: e.mime, disposition: query.dl ? 'attachment' : 'inline' });
    const h = { 'User-Agent': UA };
    if (headers.range) h.Range = headers.range;
    const up = await fetchImpl(e.url, { headers: h, redirect: 'follow', signal: AbortSignal.timeout(Number(env.DL_STREAM_TIMEOUT_MS || 600000)) });
    if (!up.ok && up.status !== 206) return { status: 502, json: { error: `The source answered ${up.status}` } };
    const len = Number(up.headers.get('content-length') || 0);
    if (len && len > MAX_MB * 1048576) { try { await up.body?.cancel(); } catch {} return { status: 413, json: { error: `File is bigger than ${MAX_MB} MB` } }; }
    const out = { 'Content-Type': e.mime || up.headers.get('content-type') || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'Content-Disposition': `${query.dl ? 'attachment' : 'inline'}; filename="${e.filename}"` };
    if (len) out['Content-Length'] = String(len);
    const cr = up.headers.get('content-range');
    if (cr) out['Content-Range'] = cr;
    return { status: up.status === 206 ? 206 : 200, headers: out, stream: Readable.fromWeb(up.body) };
  }

  const status = () => Object.keys(providers).map((n) => ({ name: n, enabled: providers[n].enabled() && order.includes(n), resting: (state[n] || { until: 0 }).until > now() }));

  const routes = [
    {
      method: ['get', 'post'], path: '/download', access: 'key',
      handler: async (ctx) => {
        const src = { ...ctx.query, ...ctx.body };
        const type = String(src.type || 'video').toLowerCase() === 'audio' ? 'audio' : 'video';
        return { json: await resolve(src.url || src.q || src.query, type, { fresh: !!src.fresh, base: ctx.base }) };
      },
    },
    { method: 'get', path: '/download/providers', access: 'key', handler: async () => ({ json: { providers: status(), order } }) },
    { method: 'get', path: '/dl/f/:token', access: 'public', limit: false, handler: (ctx) => streamFile(ctx.params.token, ctx.headers, ctx.query) },
    {
      method: 'get', path: '/dl/platforms', access: 'public',
      handler: async () => ({ json: { platforms: PLATFORMS.map((p) => p[0]), search: 'YouTube by name (q=...)', refused: 'DRM / paid streaming services (Spotify, Netflix, Apple Music, ...)', types: ['video', 'audio'] } }),
    },
  ];

  return { routes, resolve, streamFile, status, detect };
}

module.exports = { createDownloader, detect, platformOf };
