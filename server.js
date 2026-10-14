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

app.use(express.json());
app.use(cors());

app.use('/media', express.static('/tmp'));

if (!fs.existsSync('/tmp')) {
    fs.mkdirSync('/tmp', { recursive: true });
}

const cookiesPath = '/tmp/cookies.txt';
if (process.env.COOKIES_BASE64) {
    try {
        const decodedCookies = Buffer.from(process.env.COOKIES_BASE64, 'base64').toString('utf8');
        fs.writeFileSync(cookiesPath, decodedCookies);
        console.log("Cookies decoded and loaded successfully from Base64.");
    } catch (err) {
        console.warn("Failed to decode cookies base64:", err.message);
    }
}

async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 3500 } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(resource, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
}

app.post('/download', async (req, res) => {
    const { url, type } = req.body; 
    if (!url) return res.status(400).json({ success: false, error: 'URL is required' });

    const fileId = Date.now();
    const outputTemplate = `/tmp/${fileId}_%(id)s.%(ext)s`;

    let downloadedFile = null;
    let lastError = null;

    const cookiesFlag = fs.existsSync(cookiesPath) ? `--cookies "${cookiesPath}"` : '';
    const proxyFlag = process.env.PROXY_URL ? `--proxy "${process.env.PROXY_URL}"` : '';

    try {
        if (url.includes('youtube.com') || url.includes('youtu.be')) {
            console.log("🛡️ [API] Processing YouTube stream extraction...");

            const gateways = [
                'https://api.cobalt.tools/api/json',
                'https://co.wuk.sh/api/json',
                'https://co.projectlization.com/api/json',
                'https://cobalt.kike.wtf/api/json'
            ];

            let successUrl = null;
            let mediaTitle = 'KINGBOT Media Download';

            for (const gateway of gateways) {
                try {
                    const apiRes = await fetchWithTimeout(gateway, {
                        method: 'POST',
                        headers: {
                            'Accept': 'application/json',
                            'Content-Type': 'application/json',
                            'User-Agent': 'Mozilla/5.0'
                        },
                        body: JSON.stringify({
                            url: url,
                            isAudioOnly: type === 'audio'
                        })
                    }, { timeout: 3000 });
                    
                    const apiData = await apiRes.json();
                    const directUrl = apiData.url || (apiData.picker && apiData.picker[0]?.url);
                    if (directUrl) {
                        successUrl = directUrl;
                        mediaTitle = apiData.filename || apiData.text || mediaTitle;
                        console.log(`🚀 [SUCCESS] Extracted via: ${gateway}`);
                        break;
                    }
                } catch (e) {
                    // Try next mirror
                }
            }

            if (successUrl) {
                return res.json({
                    success: true,
                    title: mediaTitle,
                    downloadUrl: successUrl
                });
            }

            // --- BULLETPROOF FALLBACK ---
            // Instead of failing when YouTube blocks cloud IPs, we use local yt-dlp execution or fallback to search results
            console.log("⚠️ Gateways rate-limited. Running local yt-dlp emergency extraction...");
            let dlCmd = type === 'audio' 
                ? `yt-dlp ${cookiesFlag} -x --audio-format mp3 -o "${outputTemplate}" --no-check-certificates "${url}"`
                : `yt-dlp ${cookiesFlag} -f "best[ext=mp4]/best/b" -o "${outputTemplate}" --no-check-certificates "${url}"`;

            try {
                await execPromise(dlCmd, { maxBuffer: 1024 * 1024 * 50 });
                const files = fs.readdirSync('/tmp');
                downloadedFile = files.find(f => f.startsWith(`${fileId}_`));
            } catch (localErr) {
                lastError = localErr.stderr || localErr.message;
            }

            if (!downloadedFile) {
                return res.status(500).json({
                    success: false,
                    error: "Failed to extract direct audio stream due to YouTube datacenter blocks."
                });
            }

        } else {
            // Universal engine for Audiomack, TikTok, Instagram, etc.
            let dlCmd = type === 'audio'
                ? `yt-dlp ${cookiesFlag} ${proxyFlag} -x --audio-format mp3 -o "${outputTemplate}" --no-check-certificates "${url}"`
                : `yt-dlp ${cookiesFlag} ${proxyFlag} -f "best[ext=mp4]/best/b" -o "${outputTemplate}" --no-check-certificates "${url}"`;

            await execPromise(dlCmd, { maxBuffer: 1024 * 1024 * 50 });

            const files = fs.readdirSync('/tmp');
            downloadedFile = files.find(f => f.startsWith(`${fileId}_`));
        }

    } catch (err) {
        lastError = err.stderr || err.message || String(err);
        console.error("Downloader execution error:", lastError);
    }

    if (!downloadedFile) {
        return res.status(500).json({ 
            success: false, 
            error: `Failed to extract direct audio stream.` 
        });
    }

    const host = req.get('host');
    const protocol = req.protocol;
    const downloadUrl = `${protocol}://${host}/media/${downloadedFile}`;

    res.json({
        success: true,
        title: 'KINGBOT Media Download',
        downloadUrl: downloadUrl
    });
});

app.get('/search', async (req, res) => {
    const query = req.query.q;
    if (!query) return res.status(400).json({ success: false, error: 'Query is required' });

    try {
        const searchResult = await yts(query);
        const video = searchResult.videos[0];
        if (!video) return res.status(404).json({ success: false, error: 'No results found' });

        res.json({
            success: true,
            title: video.title,
            url: video.url,
            thumbnail: video.thumbnail,
            duration: video.timestamp
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.listen(PORT, () => console.log(`Kingbot API running on port ${PORT}`));
