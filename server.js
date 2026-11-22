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
const TMP_DIR = '/tmp';

app.use(express.json());
app.use(cors());
app.use('/media', express.static(TMP_DIR));

if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
}

const cookiesPath = path.join(TMP_DIR, 'cookies.txt');
if (process.env.COOKIES_BASE64) {
    try {
        const decodedCookies = Buffer.from(process.env.COOKIES_BASE64, 'base64').toString('utf8');
        if (decodedCookies.trim().length > 0) {
            fs.writeFileSync(cookiesPath, decodedCookies);
            console.log('Cookies decoded and written to /tmp/cookies.txt');
        }
    } catch (err) {
        console.warn('Failed to decode COOKIES_BASE64:', err.message);
    }
}

const YT_PERSONAS = [
    {
        name: 'mweb-chrome',
        playerClient: 'mweb',
        impersonate: 'chrome',
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
        referer: 'https://m.youtube.com/',
        useCookies: true,
        useProxy: true
    },
    {
        name: 'safari-persona',
        playerClient: 'web_safari',
        impersonate: 'safari',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
        referer: 'https://www.youtube.com/',
        useCookies: true,
        useProxy: true
    },
    {
        name: 'default-minus-embed-direct',
        playerClient: 'default,-web_embedded',
        impersonate: 'chrome',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        referer: 'https://www.youtube.com/',
        useCookies: false,
        useProxy: false
    },
    {
        name: 'mweb-stealth-noproxy',
        playerClient: 'mweb',
        impersonate: null,
        userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
        referer: 'https://m.youtube.com/',
        useCookies: false,
        useProxy: false
    }
];

function shufflePersonas(list) {
    const arr = [...list];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function jitterSleep(minMs = 1200, maxMs = 2600) {
    const delay = Math.floor(minMs + Math.random() * (maxMs - minMs));
    return new Promise(resolve => setTimeout(resolve, delay));
}

function isYouTubeUrl(url = '') {
    return /https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(url);
}

function isAudiomackUrl(url = '') {
    return /https?:\/\/(www\.)?audiomack\.com\//i.test(url);
}

function findDownloadedFile(prefix) {
    try {
        const files = fs.readdirSync(TMP_DIR);
        const match = files.find(
            f => f.startsWith(`${prefix}_`) && !f.endsWith('.part') && !f.endsWith('.ytdl') && !f.endsWith('.temp')
        );
        if (!match) return null;
        const fullPath = path.join(TMP_DIR, match);
        const stats = fs.statSync(fullPath);
        return stats.size > 1024 ? match : null;
    } catch (_) {
        return null;
    }
}

function cleanupPrefixFiles(prefix) {
    try {
        const files = fs.readdirSync(TMP_DIR);
        for (const file of files) {
            if (file.startsWith(`${prefix}_`)) {
                fs.unlinkSync(path.join(TMP_DIR, file));
            }
        }
    } catch (_) {}
}

async function runDisguisedYtDlp({
    url,
    type,
    fileId,
    playerClient = null,
    impersonate = null,
    userAgent = null,
    referer = null,
    useCookies = false,
    useProxy = false
}) {
    const outputTemplate = path.join(TMP_DIR, `${fileId}_%(id)s.%(ext)s`);
    const args = [
        '--no-warnings',
        '--no-playlist',
        '--force-ipv4',
        '--remote-components',
        'ejs:github',
        '--sleep-requests',
        '1.5',
        '--retries',
        '4',
        '--retry-sleep',
        'http:linear=2:6:2',
        '--fragment-retries',
        '4',
        '--retry-sleep',
        'fragment:linear=2:6:2'
    ];

    if (userAgent) {
        args.push('--user-agent', userAgent);
    }

    if (referer) {
        args.push('--referer', referer);
    }

    if (impersonate) {
        args.push('--impersonate', impersonate);
    }

    if (useCookies && fs.existsSync(cookiesPath)) {
        args.push('--cookies', cookiesPath);
    }

    if (useProxy && process.env.PROXY_URL) {
        args.push('--proxy', process.env.PROXY_URL);
    }

    if (playerClient) {
        args.push('--extractor-args', `youtube:player_client=${playerClient}`);
    }

    if (type === 'audio') {
        args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
    } else {
        args.push(
            '-f',
            'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            '--merge-output-format',
            'mp4'
        );
    }

    args.push('-o', outputTemplate, url);

    await execFilePromise('yt-dlp', args, {
        maxBuffer: 1024 * 1024 * 64,
        timeout: 120000
    });

    return findDownloadedFile(fileId);
}

async function tryAudiomackDirect(url, fileId) {
    const outputFile = path.join(TMP_DIR, `${fileId}_audiomack.mp3`);
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': 'https://audiomack.com/'
    };

    const res = await fetch(url, { headers, redirect: 'follow' });
    if (!res.ok) {
        throw new Error(`Audiomack page fetch failed with HTTP ${res.status}`);
    }
    const html = await res.text();

    const streamMatches = [
        ...html.matchAll(/https?:\/\/[^"'\\\s<>]+audiomack\.com[^"'\\\s<>]*\.(?:mp3|m4a|aac|ogg)[^"'\\\s<>]*/gi),
        ...html.matchAll(/https?:\/\/[^"'\\\s<>]+stream[^"'\\\s<>]*\.(?:mp3|m4a|aac|ogg)[^"'\\\s<>]*/gi)
    ];

    const candidateUrl = streamMatches.map(m => m[0].replace(/\\u002F/g, '/').replace(/\\\//g, '/'))[0];
    if (!candidateUrl) {
        throw new Error('No direct audio stream URL found on Audiomack page');
    }

    const audioRes = await fetch(candidateUrl, { headers });
    if (!audioRes.ok) {
        throw new Error(`Audiomack audio stream failed with HTTP ${audioRes.status}`);
    }

    const buffer = Buffer.from(await audioRes.arrayBuffer());
    if (buffer.length < 1024) {
        throw new Error('Audiomack audio payload too small');
    }

    fs.writeFileSync(outputFile, buffer);
    return path.basename(outputFile);
}

async function tryExternalMirrors(url, type) {
    const gateways = [
        'https://api.cobalt.tools/api/json',
        'https://co.wuk.sh/api/json',
        'https://co.projectlization.com/api/json'
    ];

    for (const gateway of gateways) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
            const res = await fetch(gateway, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                body: JSON.stringify({
                    url,
                    downloadMode: type === 'audio' ? 'audio' : 'auto',
                    isAudioOnly: type === 'audio'
                }),
                signal: controller.signal
            });
            clearTimeout(timer);

            if (!res.ok) continue;
            const data = await res.json();
            const directUrl = data.url || (Array.isArray(data.picker) && data.picker[0]?.url);

            if (directUrl && !isYouTubeUrl(directUrl)) {
                return {
                    downloadUrl: directUrl,
                    title: data.filename || data.text || 'KINGBOT Media Download'
                };
            }
        } catch (err) {
            clearTimeout(timer);
            console.warn(`[MIRROR FAIL - ${gateway}]:`, err.message);
        }
    }
    return null;
}

async function tryRemoteWorker(url, type) {
    const workerBase = (process.env.REMOTE_WORKER_URL || '').replace(/\/+$/, '');
    if (!workerBase) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
        console.log(`[WORKER TRY] Forwarding ${type} request to ${workerBase}/download`);
        const res = await fetch(`${workerBase}/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, type }),
            signal: controller.signal
        });
        clearTimeout(timer);

        if (!res.ok) return null;
        const data = await res.json();
        if (data && data.success && data.downloadUrl) {
            return {
                title: data.title || 'KINGBOT Media Download',
                downloadUrl: data.downloadUrl
            };
        }
    } catch (err) {
        clearTimeout(timer);
        console.warn('[WORKER FAIL]:', err.message);
    }
    return null;
}

app.get('/', (req, res) => {
    res.json({
        status: 'online',
        service: 'KINGBOT-API',
        mode: 'persona-disguise',
        cookiesLoaded: fs.existsSync(cookiesPath),
        proxyConfigured: Boolean(process.env.PROXY_URL),
        remoteWorkerConfigured: Boolean(process.env.REMOTE_WORKER_URL)
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

app.post('/download', async (req, res) => {
    const { url, type = 'audio' } = req.body || {};
    if (!url || typeof url !== 'string') {
        return res.status(400).json({ success: false, error: 'URL is required' });
    }

    const fileId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let downloadedFile = null;
    let lastError = '';

    console.log(`[DOWNLOAD REQUEST] type=${type} url=${url}`);

    try {
        if (isYouTubeUrl(url)) {
            const rotatedPersonas = shufflePersonas(YT_PERSONAS);

            for (const persona of rotatedPersonas) {
                try {
                    console.log(`[PERSONA TRY - ${persona.name}] client=${persona.playerClient} impersonate=${persona.impersonate || 'none'}`);
                    downloadedFile = await runDisguisedYtDlp({
                        url,
                        type,
                        fileId,
                        playerClient: persona.playerClient,
                        impersonate: persona.impersonate,
                        userAgent: persona.userAgent,
                        referer: persona.referer,
                        useCookies: persona.useCookies,
                        useProxy: persona.useProxy
                    });
                    if (downloadedFile) {
                        console.log(`[PERSONA SUCCESS - ${persona.name}] Saved ${downloadedFile}`);
                        break;
                    }
                } catch (err) {
                    cleanupPrefixFiles(fileId);
                    lastError = (err.stderr || err.message || String(err)).trim();
                    console.error(`[PERSONA FAIL - ${persona.name}]:`, lastError.slice(-500));
                    await jitterSleep(1300, 2700);
                }
            }

            if (!downloadedFile) {
                const mirrorResult = await tryExternalMirrors(url, type);
                if (mirrorResult) {
                    return res.json({
                        success: true,
                        title: mirrorResult.title,
                        downloadUrl: mirrorResult.downloadUrl
                    });
                }
            }
        } else {
            const nonYtPersonas = [
                {
                    name: 'chrome-impersonate-direct',
                    impersonate: 'chrome',
                    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                    referer: url,
                    useProxy: false
                },
                {
                    name: 'safari-impersonate-direct',
                    impersonate: 'safari',
                    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
                    referer: url,
                    useProxy: false
                },
                {
                    name: 'chrome-impersonate-proxy',
                    impersonate: 'chrome',
                    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                    referer: url,
                    useProxy: true
                }
            ];

            for (const persona of nonYtPersonas) {
                try {
                    console.log(`[NON-YT TRY - ${persona.name}]`);
                    downloadedFile = await runDisguisedYtDlp({
                        url,
                        type,
                        fileId,
                        impersonate: persona.impersonate,
                        userAgent: persona.userAgent,
                        referer: persona.referer,
                        useCookies: false,
                        useProxy: persona.useProxy
                    });
                    if (downloadedFile) {
                        console.log(`[NON-YT SUCCESS - ${persona.name}] Saved ${downloadedFile}`);
                        break;
                    }
                } catch (err) {
                    cleanupPrefixFiles(fileId);
                    lastError = (err.stderr || err.message || String(err)).trim();
                    console.error(`[NON-YT FAIL - ${persona.name}]:`, lastError.slice(-500));
                    await jitterSleep(800, 1600);
                }
            }

            if (!downloadedFile && isAudiomackUrl(url)) {
                try {
                    console.log('[AUDIOMACK FALLBACK] Attempting direct page stream extraction...');
                    downloadedFile = await tryAudiomackDirect(url, fileId);
                    if (downloadedFile) {
                        console.log(`[AUDIOMACK SUCCESS] Saved ${downloadedFile}`);
                    }
                } catch (err) {
                    cleanupPrefixFiles(fileId);
                    lastError = (err.message || String(err)).trim();
                    console.error('[AUDIOMACK FAIL]:', lastError.slice(-500));
                }
            }

            if (!downloadedFile) {
                const mirrorResult = await tryExternalMirrors(url, type);
                if (mirrorResult) {
                    return res.json({
                        success: true,
                        title: mirrorResult.title,
                        downloadUrl: mirrorResult.downloadUrl
                    });
                }
            }
        }

        if (!downloadedFile) {
            const workerResult = await tryRemoteWorker(url, type);
            if (workerResult) {
                return res.json({
                    success: true,
                    title: workerResult.title,
                    downloadUrl: workerResult.downloadUrl
                });
            }
        }

        if (!downloadedFile) {
            return res.status(200).json({
                success: false,
                error: type === 'video'
                    ? 'Failed to extract direct video stream.'
                    : 'Failed to extract direct audio stream.',
                details: lastError.slice(-400)
            });
        }

        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.get('host');
        const downloadUrl = `${protocol}://${host}/media/${encodeURIComponent(downloadedFile)}`;

        return res.json({
            success: true,
            title: 'KINGBOT Media Download',
            downloadUrl
        });
    } catch (err) {
        cleanupPrefixFiles(fileId);
        console.error('Unexpected /download error:', err);
        return res.status(200).json({
            success: false,
            error: type === 'video'
                ? 'Failed to extract direct video stream.'
                : 'Failed to extract direct audio stream.',
            details: String(err.message || err).slice(-400)
        });
    }
});

app.get('/search', async (req, res) => {
    const query = (req.query.q || '').trim();
    if (!query) {
        return res.status(400).json({ success: false, error: 'Query is required' });
    }

    try {
        const searchResult = await yts(query);
        const video = searchResult.videos && searchResult.videos[0];
        if (!video) {
            return res.status(404).json({ success: false, error: 'No results found' });
        }

        return res.json({
            success: true,
            title: video.title,
            url: video.url,
            thumbnail: video.thumbnail,
            duration: video.timestamp
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`KINGBOT-API running on port ${PORT}`);
});
