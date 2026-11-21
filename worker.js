/**
 * Home worker hub: lets a device of YOURS (phone / PC with a normal internet connection) do the downloading with yt-dlp.
 * The worker only makes OUTGOING requests to this API, so it needs no domain, tunnel or open port:
 *   POST /worker/poll            the worker asks "any job for me?" (waits up to ~25 s)
 *   PUT  /worker/file/:id        the worker sends the finished file
 *   POST /worker/fail/:id        the worker says it could not do the job
 *   GET  /worker/status          (your API key) is the worker online?
 * Everything under /worker is protected by WORKER_TOKEN (a long secret you make up and put on both sides).
 * Files are kept in the server's temp folder for 30 minutes and then deleted.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { limiter, httpError } = require('./util');

const MIME = { mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', mov: 'video/quicktime', mp3: 'audio/mpeg', m4a: 'audio/mp4', opus: 'audio/ogg', ogg: 'audio/ogg', aac: 'audio/aac', wav: 'audio/wav', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001F]/g, ' ').trim().slice(0, n);

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start, end;
  if (m[1] === '') { start = Math.max(0, size - Number(m[2])); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1); }
  return start > end || start >= size ? 'bad' : { start, end };
}

function createWorkerHub({ env = process.env, now = () => Date.now(), dir } = {}) {
  const token = String(env.WORKER_TOKEN || '');
  const tmp = dir || path.join(os.tmpdir(), 'king-worker-files');
  fs.rmSync(tmp, { recursive: true, force: true }); // leftovers from a previous run
  fs.mkdirSync(tmp, { recursive: true });
  const MAX_MB = Number(env.WORKER_MAX_MB || 100);
  const JOB_TIMEOUT = Number(env.WORKER_JOB_TIMEOUT_MS || 90000);
  const POLL_MS = Number(env.WORKER_POLL_MS || 25000);
  const FILE_TTL = Number(env.WORKER_FILE_TTL_MS || 1800000);
  const STORE_CAP = Number(env.WORKER_STORE_MB || 300) * 1048576; // everything kept at once; the oldest files are deleted first
  const ONLINE_MS = POLL_MS + Number(env.WORKER_ONLINE_GRACE_MS ?? 15000);

  const RETRY_CODES = new Set(['blocked', 'rate_limited', 'timeout']); // another worker (another network) may succeed where this one failed
  const workers = new Map(); // name -> { lastSeen, ytdlp, ffmpeg }
  const queue = [];   // jobs nobody has picked up yet
  const waiters = []; // workers waiting for a job
  const jobs = new Map();
  const files = new Map();
  let lastSeen = 0;
  let info = {};
  const badAuth = limiter(20, 60000);

  const configured = () => token.length >= 16;
  const isOnline = () => configured() && lastSeen > 0 && now() - lastSeen < ONLINE_MS;
  const onlineNames = () => [...workers.entries()].filter(([, w]) => now() - w.lastSeen < ONLINE_MS).map(([n]) => n);

  function auth(ctx) {
    if (!configured()) throw httpError(503, 'The worker is not set up (WORKER_TOKEN is missing or too short)');
    const given = ctx.headers['x-worker-token'] || '';
    if (!safeEqual(given, token)) {
      if (!badAuth(ctx.ip || 'unknown')) throw httpError(429, 'Too many attempts');
      throw httpError(401, 'Invalid worker token');
    }
  }

  function finish(rec, value, err) {
    if (rec.done) return;
    rec.done = true;
    clearTimeout(rec.timer);
    jobs.delete(rec.id);
    const i = queue.indexOf(rec);
    if (i >= 0) queue.splice(i, 1);
    err ? rec.reject(err) : rec.resolve(value);
  }

  /** Give a job to a waiting worker, or queue it. Resolves when the worker has delivered the file. */
  function submit(job) {
    return new Promise((resolve, reject) => {
      const rec = { id: crypto.randomBytes(8).toString('hex'), ...job, resolve, reject, done: false, tried: new Set() };
      rec.timer = setTimeout(() => finish(rec, null, new Error('Your home worker did not answer in time')), JOB_TIMEOUT);
      jobs.set(rec.id, rec);
      dispatch(rec);
    });
  }

  /** Hand the job to a waiting worker that has not tried it yet, or keep it in the queue. */
  function dispatch(rec) {
    const i = waiters.findIndex((w) => !rec.tried.has(w.name));
    if (i >= 0) { const [w] = waiters.splice(i, 1); clearTimeout(w.timer); rec.tried.add(w.name); w.resolve(rec); }
    else queue.push(rec);
  }

  async function poll(ctx) {
    auth(ctx);
    lastSeen = now();
    const name = clean(ctx.body.name, 40) || 'worker';
    info = { name, ytdlp: clean(ctx.body.ytdlp, 30), ffmpeg: !!ctx.body.ffmpeg };
    workers.set(name, { lastSeen: now(), ytdlp: info.ytdlp, ffmpeg: info.ffmpeg });
    const idx = queue.findIndex((r) => !r.tried.has(name));
    let rec = idx >= 0 ? queue.splice(idx, 1)[0] : null;
    if (rec) rec.tried.add(name);
    if (!rec) {
      rec = await new Promise((resolve) => {
        const w = { name, resolve, timer: setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); resolve(null); }, POLL_MS) };
        waiters.push(w);
        ctx.req?.once?.('close', () => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); clearTimeout(w.timer); resolve(null); } });
      });
    }
    lastSeen = now();
    workers.get(name).lastSeen = now();
    if (!rec || rec.done) return { json: { job: null } };
    return { json: { job: { id: rec.id, url: rec.url, query: rec.query, type: rec.type } } };
  }

  /** Make room before a new file arrives: delete the oldest stored files until the new one fits. */
  function makeRoom(need) {
    let total = 0;
    for (const f of files.values()) total += f.size;
    for (const [id, f] of [...files.entries()].sort((a, b) => a[1].expires - b[1].expires)) {
      if (total + need <= STORE_CAP) break;
      fs.rm(f.path, { force: true }, () => {});
      files.delete(id);
      total -= f.size;
    }
  }

  async function upload(ctx) {
    auth(ctx);
    const rec = jobs.get(ctx.params.id);
    if (!rec || rec.done) throw httpError(404, 'Unknown or finished job');
    const q = ctx.query;
    const ext = String(q.ext || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin';
    const fileId = crypto.randomBytes(16).toString('hex');
    const p = path.join(tmp, `${fileId}.${ext}`);
    const cap = MAX_MB * 1048576;
    makeRoom(cap);
    let size = 0;
    const counter = new Transform({ transform(chunk, enc, cb) { size += chunk.length; cb(size > cap ? new Error('too_big') : null, chunk); } });
    try {
      await pipeline(ctx.req, counter, fs.createWriteStream(p));
    } catch (e) {
      fs.rm(p, { force: true }, () => {});
      const big = e.message === 'too_big';
      finish(rec, null, new Error(big ? `The file is bigger than ${MAX_MB} MB` : 'The file upload from the worker failed'));
      throw httpError(big ? 413 : 502, big ? 'File too big' : 'Upload failed');
    }
    if (!size) { fs.rm(p, { force: true }, () => {}); finish(rec, null, new Error('The worker sent an empty file')); throw httpError(422, 'Empty file'); }
    files.set(fileId, { path: p, size, ext, mime: MIME[ext] || 'application/octet-stream', expires: now() + FILE_TTL });
    finish(rec, { fileId, ext, size, title: clean(q.title, 150), thumbnail: clean(q.thumbnail, 500), duration: clean(q.duration, 20), author: clean(q.author, 100) });
    return { json: { ok: true } };
  }

  async function fail(ctx) {
    auth(ctx);
    const rec = jobs.get(ctx.params.id);
    if (!rec) return { json: { ok: true } };
    const code = clean(ctx.body.code, 30);
    const err = Object.assign(new Error(clean(ctx.body.error, 300) || 'The worker could not download that'), { code });
    if (RETRY_CODES.has(code) && !rec.done) {
      const another = onlineNames().some((n) => !rec.tried.has(n)); // a different worker that is online and has not tried it
      if (another) { rec.lastError = err; dispatch(rec); return { json: { ok: true, retried: true } }; }
    }
    finish(rec, null, err);
    return { json: { ok: true } };
  }

  const has = (id) => { const f = files.get(id); return !!f && f.expires > now() && fs.existsSync(f.path); };

  /** Open a stored file for the /dl/f/<token> route (supports Range, so players can seek). */
  function open(id, rangeHeader, { filename = 'download', mime, disposition = 'inline' } = {}) {
    const f = files.get(id);
    if (!f || f.expires <= now() || !fs.existsSync(f.path)) return { status: 404, json: { error: 'This download link has expired. Request it again.' } };
    const headers = { 'Content-Type': mime || f.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'Content-Disposition': `${disposition}; filename="${filename}"` };
    const range = parseRange(rangeHeader, f.size);
    if (range === 'bad') return { status: 416, headers: { 'Content-Range': `bytes */${f.size}` }, json: { error: 'Bad range' } };
    if (range) {
      headers['Content-Range'] = `bytes ${range.start}-${range.end}/${f.size}`;
      headers['Content-Length'] = String(range.end - range.start + 1);
      return { status: 206, headers, stream: fs.createReadStream(f.path, { start: range.start, end: range.end }) };
    }
    headers['Content-Length'] = String(f.size);
    return { status: 200, headers, stream: fs.createReadStream(f.path) };
  }

  setInterval(() => { for (const [id, f] of files) if (f.expires <= now()) { fs.rm(f.path, { force: true }, () => {}); files.delete(id); } }, 60000).unref();

  const status = () => ({ configured: configured(), online: isOnline(), workers: [...workers.entries()].map(([name, w]) => ({ name, online: now() - w.lastSeen < ONLINE_MS, seconds_since_seen: Math.round((now() - w.lastSeen) / 1000), ytdlp: w.ytdlp, ffmpeg: w.ffmpeg })), seconds_since_seen: lastSeen ? Math.round((now() - lastSeen) / 1000) : null, worker: info, waiting_jobs: queue.length, stored_files: files.size, stored_mb: Math.round([...files.values()].reduce((n, f) => n + f.size, 0) / 1048576) });

  const provider = {
    enabled: () => isOnline(),
    supports: (d) => d.kind === 'url' || d.kind === 'query',
    async run(d, type) {
      const r = await submit({ url: d.kind === 'url' ? d.url : undefined, query: d.kind === 'query' ? d.query : undefined, type });
      return { title: r.title || 'Download', ext: r.ext, thumbnail: r.thumbnail || undefined, duration: r.duration || undefined, author: r.author || undefined, local: r.fileId };
    },
  };

  const routes = [
    { method: 'post', path: '/worker/poll', access: 'public', limit: false, handler: poll },
    { method: 'put', path: '/worker/file/:id', access: 'public', limit: false, handler: upload },
    { method: 'post', path: '/worker/fail/:id', access: 'public', limit: false, handler: fail },
    { method: 'get', path: '/worker/status', access: 'key', handler: async () => ({ json: status() }) },
  ];

  return { routes, provider, status, has, open, isOnline, configured, _submit: submit };
}

module.exports = { createWorkerHub };
