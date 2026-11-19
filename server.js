const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
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
        fs.writeFileSync(cookiesPath, decodedCookies);
        console.log("Cookies loaded from COOKIES_BASE64.");
    } catch (err) {
        console.warn("Failed to decode COOKIES_BASE64:", err.message);
    }
}

function isYouTubeUrl(url = '') {
    return url.includes('youtube.com') || url.includes('youtu.be');
}

function findDownloadedFile(prefix) {
    try {
        const files = fs.readdirSync(TMP_DIR);
        const match = files.find(f => f.startsWith(`${prefix}_`) && !f.endsWith('.part') && !f.endsWith('.ytdl'));
        if (!match) return null;
        const fullPath = path.join(TMP_DIR, match);
        const stats = fs.statSync(fullPath);
        return stats.size > 1024 ? match : null;
    } catch (_) {
        return null;
    }
}

async function runYtDlp({ url, type, fileId, cookiesFlag, proxyFlag, playerClient = null }) {
    const outputTemplate = path.join(TMP_DIR, `${fileId}_%(id)s.%(ext)s`);
    const clientFlag = playerClient
        ? `--extractor-args "youtube:player_client=${playerClient}"`
        : '';
    const formatFlag = type === 'audio'
        ? `-x --audio-format mp3 --audio-quality 0`
        : `-f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --merge-output-format mp4`;

    const cmd = [
        'yt-dlp',
        '--no-warnings',
        '--no-playlist',
        '--force-ipv4',
        '--no-check-certificates',
        '--remote-components ejs:github',
        cookiesFlag,
        proxyFlag,
        clientFlag,
        formatFlag,
        `-o "${outputTemplate}"`,
        `"${url}"`
    ].filter(Boolean).join(' ');

    await execPromise(cmd, {
        maxBuffer: 1024 * 1024 * 64,
        timeout: 90000
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

            // Reject any fallback page URL that is not an actual media/stream URL
            if (directUrl && !isYouTubeUrl(directUrl)) {
                return {
                    downloadUrl: directUrl,
                    title: data.filename || data.text || 'KINGBOT Media Download'
                };
            }
        } catch (_) {
            clearTimeout(timer);
        }
    }
    return null;
}

app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

app.post('/download', async (req, res) => {
    const { url, type = 'audio' } = req.body || {};
    if (!url || typeof url !== 'string') {
        return res.status(400).json({ success: false, error: 'URL is required' });
    }

    const fileId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const cookiesFlag = fs.existsSync(cookiesPath) ? `--cookies "${cookiesPath}"` : '';
    const proxyFlag = process.env.PROXY_URL ? `--proxy "${process.env.PROXY_URL}"` : '';

    let downloadedFile = null;
    let lastError = '';

    try {
        if (isYouTubeUrl(url)) {
            const clientRotation = ['tv_downgraded', 'mweb', 'web_creator', 'android_vr'];

            for (const client of clientRotation) {
                try {
                    downloadedFile = await runYtDlp({
                        url,
                        type,
                        fileId,
                        cookiesFlag,
                        proxyFlag,
                        playerClient: client
                    });
                    if (downloadedFile) break;
                } catch (err) {
                    lastError = err.stderr || err.message || String(err);
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
            // Audiomack, Instagram, Facebook, TikTok, SoundCloud, etc.
            try {
                downloadedFile = await runYtDlp({
                    url,
                    type,
                    fileId,
                    cookiesFlag,
                    proxyFlag
                });
            } catch (err) {
                lastError = err.stderr || err.message || String(err);
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
                details: lastError.slice(-300)
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
        console.error('Unexpected /download error:', err);
        return res.status(200).json({
            success: false,
            error: type === 'video'
                ? 'Failed to extract direct video stream.'
                : 'Failed to extract direct audio stream.'
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
