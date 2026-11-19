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

function isYouTubeUrl(url = '') {
    return /https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url);
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

async function runYtDlp({
    url,
    type,
    fileId,
    playerClient = null,
    useCookies = true,
    useProxy = true,
    useImpersonate = false
}) {
    const outputTemplate = path.join(TMP_DIR, `${fileId}_%(id)s.%(ext)s`);
    const args = [
        '--no-warnings',
        '--no-playlist',
        '--force-ipv4',
        '--no-check-certificates',
        '--remote-components',
        'ejs:github',
        '--retries',
        '5',
        '--retry-sleep',
        'http:linear=1:4:1',
        '--fragment-retries',
        '5',
        '--retry-sleep',
        'fragment:linear=1:4:1'
    ];

    if (useImpersonate) {
        args.push('--impersonate', 'chrome');
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

app.get('/', (req, res) => {
    res.json({
        status: 'online',
        service: 'KINGBOT-API',
        cookiesLoaded: fs.existsSync(cookiesPath),
        proxyConfigured: Boolean(process.env.PROXY_URL)
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
            const attempts = [
                { label: 'auto+cookies+proxy', playerClient: null, useCookies: true, useProxy: true, useImpersonate: false },
                { label: 'mweb+cookies+proxy', playerClient: 'mweb', useCookies: true, useProxy: true, useImpersonate: false },
                { label: 'mweb+no-cookies+proxy', playerClient: 'mweb', useCookies: false, useProxy: true, useImpersonate: false },
                { label: 'web_creator+cookies+proxy', playerClient: 'web_creator', useCookies: true, useProxy: true, useImpersonate: false },
                { label: 'tv_downgraded+cookies+proxy', playerClient: 'tv_downgraded', useCookies: true, useProxy: true, useImpersonate: false },
                { label: 'auto+no-cookies+no-proxy', playerClient: null, useCookies: false, useProxy: false, useImpersonate: false }
            ];

            for (const attempt of attempts) {
                try {
                    console.log(`[YT-DLP TRY - ${attempt.label}] Attempting extraction...`);
                    downloadedFile = await runYtDlp({
                        url,
                        type,
                        fileId,
                        playerClient: attempt.playerClient,
                        useCookies: attempt.useCookies,
                        useProxy: attempt.useProxy,
                        useImpersonate: attempt.useImpersonate
                    });
                    if (downloadedFile) {
                        console.log(`[YT-DLP SUCCESS - ${attempt.label}] Saved ${downloadedFile}`);
                        break;
                    }
                } catch (err) {
                    cleanupPrefixFiles(fileId);
                    lastError = (err.stderr || err.message || String(err)).trim();
                    console.error(`[YT-DLP FAIL - ${attempt.label}]:`, lastError.slice(-500));
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
            const nonYtAttempts = [
                { label: 'universal+impersonate', useImpersonate: true, useProxy: true },
                { label: 'universal+no-impersonate', useImpersonate: false, useProxy: true }
            ];

            for (const attempt of nonYtAttempts) {
                try {
                    console.log(`[YT-DLP TRY - ${attempt.label}] Attempting extraction...`);
                    downloadedFile = await runYtDlp({
                        url,
                        type,
                        fileId,
                        useCookies: false,
                        useProxy: attempt.useProxy,
                        useImpersonate: attempt.useImpersonate
                    });
                    if (downloadedFile) {
                        console.log(`[YT-DLP SUCCESS - ${attempt.label}] Saved ${downloadedFile}`);
                        break;
                    }
                } catch (err) {
                    cleanupPrefixFiles(fileId);
                    lastError = (err.stderr || err.message || String(err)).trim();
                    console.error(`[YT-DLP FAIL - ${attempt.label}]:`, lastError.slice(-500));
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
