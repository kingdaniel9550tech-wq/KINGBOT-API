// KINGBOT-API (Railway): fixed version.
// Same endpoints as before:  POST /download {url, type}   GET /search?q=   GET /health
// Fixes: cookies are no longer public, files are deleted automatically, optional API key, JS runtime for YouTube,
//        smaller files, clear "YouTube is blocking this server" message, at most MAX_JOBS downloads at once.
const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const util = require('util');
const execFilePromise = util.promisify(execFile);
const yts = require('yt-search');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Only this folder is public (/media). Cookies live OUTSIDE it, so they can never be downloaded.
const MEDIA_DIR = process.env.MEDIA_DIR || '/tmp/media';
const cookiesPath = path.join(path.dirname(MEDIA_DIR), 'cookies.txt');
const MEDIA_TTL_MS = Number(process.env.MEDIA_TTL_MS || 20 * 60 * 1000); // files are deleted after 20 minutes
const MAX_JOBS = Number(process.env.MAX_JOBS || 2);
const JS_RUNTIME = process.env.JS_RUNTIME || 'node'; // YouTube needs a JavaScript runtime for yt-dlp
const API_KEY = process.env.API_KEY || '';
const BUDGET_MS = Number(process.env.DOWNLOAD_BUDGET_MS || 100000); // stop trying after this long

app.use(express.json());
app.use(cors());

fs.mkdirSync(MEDIA_DIR, { recursive: true });
for (const f of fs.readdirSync(MEDIA_DIR)) { try { fs.rmSync(path.join(MEDIA_DIR, f), { force: true, recursive: true }); } catch {} } // start clean
app.use('/media', express.static(MEDIA_DIR, { dotfiles: 'deny', index: false }));

if (process.env.COOKIES_BASE64) {
  try {
    const decoded = Buffer.from(process.env.COOKIES_BASE64, 'base64').toString('utf8');
    if (decoded.trim().length > 0) { fs.writeFileSync(cookiesPath, decoded, { mode: 0o600 }); console.log('Cookies loaded (kept private)'); }
  } catch (err) { console.warn('Failed to decode COOKIES_BASE64:', err.message); }
}

if (!API_KEY) console.warn('[WARN] API_KEY is not set: anyone who knows this address can use your downloader. Set API_KEY in Railway.');
function requireKey(req, res, next) {
  if (!API_KEY) return next();
  const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.headers['x-api-key'];
  if (given === API_KEY) return next();
  return res.status(401).json({ success: false, error: 'Invalid API key' });
}

const isYouTubeUrl = (url = '') => /https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(url);
const isAudiomackUrl = (url = '') => /https?:\/\/(www\.)?audiomack\.com\//i.test(url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findDownloadedFile(prefix) {
  try {
    const match = fs.readdirSync(MEDIA_DIR).find((f) => f.startsWith(`${prefix}_`) && !/\.(part|ytdl|temp)$/.test(f));
    if (!match) return null;
    return fs.statSync(path.join(MEDIA_DIR, match)).size > 1024 ? match : null;
  } catch { return null; }
}
function cleanupPrefixFiles(prefix) {
  try { for (const f of fs.readdirSync(MEDIA_DIR)) if (f.startsWith(`${prefix}_`)) fs.unlinkSync(path.join(MEDIA_DIR, f)); } catch {}
}
/** Deletes downloads older than MEDIA_TTL_MS so the disk never fills up. */
function sweep(now = Date.now()) {
  let removed = 0;
  try {
    for (const f of fs.readdirSync(MEDIA_DIR)) {
      const p = path.join(MEDIA_DIR, f);
      try { if (now - fs.statSync(p).mtimeMs > MEDIA_TTL_MS) { fs.rmSync(p, { force: true, recursive: true }); removed++; } } catch {}
    }
  } catch {}
  return removed;
}
setInterval(sweep, 5 * 60 * 1000).unref();

/** One short, honest sentence for the log and the reply. */
function explain(text = '') {
  if (/confirm you.?re not a bot/i.test(text)) return { reason: 'youtube_blocked', message: "YouTube is blocking this server's address (bot check). This host cannot download YouTube." };
  if (/Private video|Video unavailable|has been removed/i.test(text)) return { reason: 'unavailable', message: 'That video is private or unavailable.' };
  if (/Requested format is not available|n challenge|Only images are available/i.test(text)) return { reason: 'format', message: 'No usable format was found (the YouTube challenge solver may need a JavaScript runtime or a newer yt-dlp).' };
  if (/HTTP Error 429|Too Many Requests/i.test(text)) return { reason: 'rate_limited', message: 'The site is rate limiting this server.' };
  return { reason: 'failed', message: String(text).split('\n').filter(Boolean).pop() || 'Download failed.' };
}

async function runYtDlp({ url, type, fileId, playerClient = null, useCookies = false, useProxy = false, useImpersonate = false, timeoutMs = 60000 }) {
  const args = [
    '--no-warnings', '--no-playlist', '--force-ipv4', '--no-check-certificates',
    '--js-runtimes', JS_RUNTIME, '--remote-components', 'ejs:github',
    '--max-filesize', process.env.MAX_FILESIZE || '100M',
    '--sleep-requests', '1', '--retries', '3', '--fragment-retries', '3',
  ];
  if (useImpersonate) args.push('--impersonate', 'chrome');
  if (useCookies && fs.existsSync(cookiesPath)) args.push('--cookies', cookiesPath);
  if (useProxy && process.env.PROXY_URL) args.push('--proxy', process.env.PROXY_URL);
  if (playerClient) args.push('--extractor-args', `youtube:player_client=${playerClient}`);
  if (type === 'audio') args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
  else args.push('-f', 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]/best', '--merge-output-format', 'mp4');
  args.push('-o', path.join(MEDIA_DIR, `${fileId}_%(id)s.%(ext)s`), url);
  await execFilePromise('yt-dlp', args, { maxBuffer: 1024 * 1024 * 64, timeout: timeoutMs });
  return findDownloadedFile(fileId);
}

async function tryAudiomackDirect(url, fileId) {
  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', Accept: 'text/html,*/*;q=0.8', Referer: 'https://audiomack.com/' };
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) throw new Error(`Audiomack page fetch failed with HTTP ${res.status}`);
  const html = await res.text();
  const found = [...html.matchAll(/https?:\/\/[^"'\\\s<>]+\.(?:mp3|m4a|aac|ogg)[^"'\\\s<>]*/gi)].map((m) => m[0].replace(/\\u002F/g, '/').replace(/\\\//g, '/'))[0];
  if (!found) throw new Error('No direct audio stream URL found on Audiomack page');
  const audioRes = await fetch(found, { headers });
  if (!audioRes.ok) throw new Error(`Audiomack audio stream failed with HTTP ${audioRes.status}`);
  const buffer = Buffer.from(await audioRes.arrayBuffer());
  if (buffer.length < 1024) throw new Error('Audiomack audio payload too small');
  const name = `${fileId}_audiomack.mp3`;
  fs.writeFileSync(path.join(MEDIA_DIR, name), buffer);
  return name;
}

/** Optional: a cobalt instance you run yourself or have a key for (COBALT_URL, COBALT_KEY). The old public mirrors no longer work. */
async function tryCobalt(url, type) {
  if (!process.env.COBALT_URL) return null;
  try {
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (process.env.COBALT_KEY) headers.Authorization = `Api-Key ${process.env.COBALT_KEY}`;
    const res = await fetch(process.env.COBALT_URL.replace(/\/+$/, '') + '/', { method: 'POST', headers, body: JSON.stringify({ url, downloadMode: type === 'audio' ? 'audio' : 'auto' }), signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const data = await res.json();
    const direct = data.url || (Array.isArray(data.picker) && data.picker[0]?.url);
    return direct ? { downloadUrl: direct, title: data.filename || 'KINGBOT Media Download' } : null;
  } catch (err) { console.warn('[COBALT FAIL]', err.message); return null; }
}

app.get('/', (req, res) => res.json({ status: 'online', service: 'KINGBOT-API', cookiesLoaded: fs.existsSync(cookiesPath), proxyConfigured: Boolean(process.env.PROXY_URL), keyProtected: Boolean(API_KEY) }));
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

let running = 0;
app.post('/download', requireKey, async (req, res) => {
  const { url, type = 'audio' } = req.body || {};
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return res.status(400).json({ success: false, error: 'A valid URL is required' });
  if (running >= MAX_JOBS) return res.status(200).json({ success: false, error: 'The server is busy. Please try again in a moment.', reason: 'busy' });

  running++;
  const fileId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const deadline = Date.now() + BUDGET_MS;
  let downloaded = null;
  let lastError = '';
  const fail = (extra = {}) => res.status(200).json({ success: false, error: type === 'video' ? 'Failed to extract direct video stream.' : 'Failed to extract direct audio stream.', ...extra });

  try {
    console.log(`[DOWNLOAD REQUEST] type=${type} url=${url}`);
    const hasCookies = fs.existsSync(cookiesPath);
    const hasProxy = Boolean(process.env.PROXY_URL);
    const attempts = isYouTubeUrl(url)
      ? [
          { label: 'default', playerClient: null },
          ...(hasCookies ? [{ label: 'cookies', playerClient: null, useCookies: true }] : []),
          ...(hasProxy ? [{ label: 'mweb+proxy', playerClient: 'mweb', useProxy: true }, { label: 'web_embedded+proxy', playerClient: 'web_embedded', useProxy: true }] : []),
        ]
      : [
          { label: 'direct+impersonate', useImpersonate: true },
          { label: 'direct', useImpersonate: false },
          ...(hasProxy ? [{ label: 'proxy', useProxy: true }] : []),
        ];

    for (const attempt of attempts) {
      const left = deadline - Date.now();
      if (left < 5000) break;
      try {
        console.log(`[YT-DLP TRY - ${attempt.label}]`);
        downloaded = await runYtDlp({ url, type, fileId, ...attempt, timeoutMs: Math.min(60000, left) });
        if (downloaded) { console.log(`[YT-DLP SUCCESS - ${attempt.label}] ${downloaded}`); break; }
      } catch (err) {
        cleanupPrefixFiles(fileId);
        lastError = (err.stderr || err.message || String(err)).trim();
        const why = explain(lastError);
        console.error(`[YT-DLP FAIL - ${attempt.label}] ${why.reason}: ${lastError.slice(-300)}`);
        if (why.reason === 'youtube_blocked' && !hasProxy && !hasCookies) break; // nothing else to try on this host
        if (why.reason === 'unavailable') break;                                // the video itself is the problem
        await sleep(1000);
      }
    }

    if (!downloaded && isAudiomackUrl(url)) {
      try { downloaded = await tryAudiomackDirect(url, fileId); } catch (err) { cleanupPrefixFiles(fileId); lastError = err.message; }
    }
    if (!downloaded) {
      const cobalt = await tryCobalt(url, type);
      if (cobalt) return res.json({ success: true, ...cobalt });
    }
    if (!downloaded) {
      const why = explain(lastError);
      return fail({ reason: why.reason, details: why.message });
    }

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    return res.json({ success: true, title: 'KINGBOT Media Download', downloadUrl: `${protocol}://${req.get('host')}/media/${encodeURIComponent(downloaded)}` });
  } catch (err) {
    cleanupPrefixFiles(fileId);
    console.error('Unexpected /download error:', err);
    return fail({ details: String(err.message || err).slice(-300) });
  } finally { running--; }
});

app.get('/search', requireKey, async (req, res) => {
  const query = (req.query.q || '').trim();
  if (!query) return res.status(400).json({ success: false, error: 'Query is required' });
  try {
    const video = (await yts(query)).videos?.[0];
    if (!video) return res.status(404).json({ success: false, error: 'No results found' });
    return res.json({ success: true, title: video.title, url: video.url, thumbnail: video.thumbnail, duration: video.timestamp });
  } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

app.listen(PORT, () => console.log(`KINGBOT-API running on port ${PORT}`));

module.exports = { app, sweep, MEDIA_DIR, cookiesPath };
