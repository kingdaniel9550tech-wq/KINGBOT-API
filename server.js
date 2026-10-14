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
    const { timeout = 5000 } = options;
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
            console.log("🛡️ [GOD-MODE v3] Initializing multi-tier bulletproof extraction engine...");

            // --- TIER 1: Expanded Public API Gateways with Quick Fallback ---
            const gateways = [
                'https://co.wuk.sh/api/json',
                'https://api.cobalt.tools/api/json',
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
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0'
                        },
                        body: JSON.stringify({
                            url: url,
                            isAudioOnly: type === 'audio'
                        })
                    }, { timeout: 4000 });
                    
                    const apiData = await apiRes.json();
                    const directUrl = apiData.url || (apiData.picker && apiData.picker[0]?.url);
                    if (directUrl) {
                        successUrl = directUrl;
                        mediaTitle = apiData.filename || apiData.text || mediaTitle;
                        console.log(`🚀 [TIER 1] Successfully routed via gateway: ${gateway}`);
                        break;
                    }
                } catch (e) {
                    // Skip to next gateway immediately on failure or timeout
                }
            }

            if (successUrl) {
                return res.json({
                    success: true,
                    title: mediaTitle,
                    downloadUrl: successUrl
                });
            }

            // --- TIER 2: Exhaustive Local Disguise Matrix Army ---
            console.log("🔄 [TIER 2] Gateways busy. Deploying local yt-dlp multi-client disguise matrix...");
            const clientStrategies = [
                { client: 'android', skip: 'webpage' },
                { client: 'ios', skip: 'configs,js' },
                { client: 'tv_embedded', skip: '' },
                { client: 'mweb', skip: '' },
                { client: 'web', skip: '' }
            ];

            let localSuccess = false;
            for (const strat of clientStrategies) {
                try {
                    const skipArg = strat.skip ? `,player_skip=${strat.skip}` : '';
                    let dlCmd = '';
                    
                    if (type === 'audio') {
                        dlCmd = `yt-dlp ${cookiesFlag} ${proxyFlag} --impersonate chrome --extractor-args "youtube:player_client=${strat.client}${skipArg}" -x --audio-format mp3 -o "${outputTemplate}" --no-check-certificates --geo-bypass "${url}"`;
                    } else {
                        dlCmd = `yt-dlp ${cookiesFlag} ${proxyFlag} --impersonate chrome --extractor-args "youtube:player_client=${strat.client}${skipArg}" -f "best[ext=mp4]/best/b" -o "${outputTemplate}" --no-check-certificates --geo-bypass "${url}"`;
                    }

                    console.log(`🎯 [TIER 2] Testing strategy -> Client: ${strat.client}`);
                    await execPromise(dlCmd, { maxBuffer: 1024 * 1024 * 50 });

                    const files = fs.readdirSync('/tmp');
                    downloadedFile = files.find(f => f.startsWith(`${fileId}_`));

                    if (downloadedFile) {
                        console.log(`👑 [TIER 2] Breakthrough achieved using client: ${strat.client}`);
                        localSuccess = true;
                        break;
                    }
                } catch (stratErr) {
                    lastError = stratErr.stderr || stratErr.message;
                }
            }

            if (!localSuccess && !downloadedFile) {
                throw new Error("All public gateways and local disguise methods were exhausted by datacenter limits.");
            }
        } else {
            // Universal engine for Audiomack, TikTok, Instagram, etc.
            let dlCmd = '';
            if (type === 'audio') {
                dlCmd = `yt-dlp ${cookiesFlag} ${proxyFlag} -x --audio-format mp3 -o "${outputTemplate}" --no-check-certificates "${url}"`;
            } else {
                dlCmd = `yt-dlp ${cookiesFlag} ${proxyFlag} -f "best[ext=mp4]/best/b" -o "${outputTemplate}" --no-check-certificates "${url}"`;
            }

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
            error: `Download failed: ${lastError || 'Platform restriction or timeout'}` 
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

app.listen(PORT, () => console.log(`Kingbot God-Mode v3 API running on port ${PORT}`));
