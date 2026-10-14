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

function extractYouTubeId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 3000 } = options;
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
            console.log("⚡ [GOD-MODE ULTIMATE] Initiating multi-tier extraction & client army...");

            let successUrl = null;
            let mediaTitle = 'KINGBOT Media Download';

            // --- TIER 1: Public Mirror Gateways ---
            const gateways = [
                'https://api.cobalt.tools/api/json',
                'https://co.wuk.sh/api/json',
                'https://co.projectlization.com/api/json',
                'https://cobalt.kike.wtf/api/json'
            ];

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
                    }, { timeout: 2500 });
                    
                    const apiData = await apiRes.json();
                    const directUrl = apiData.url || (apiData.picker && apiData.picker[0]?.url);
                    if (directUrl) {
                        successUrl = directUrl;
                        mediaTitle = apiData.filename || apiData.text || mediaTitle;
                        console.log(`🚀 [TIER 1 SUCCESS] Extracted via mirror: ${gateway}`);
                        break;
                    }
                } catch (e) {
                    // Skip to next mirror
                }
            }

            if (successUrl) {
                return res.json({ success: true, title: mediaTitle, downloadUrl: successUrl });
            }

            // --- TIER 2: Piped Instance Stream Scraping ---
            const videoId = extractYouTubeId(url);
            if (videoId) {
                const pipedInstances = [
                    'https://pipedapi.kavin.rocks',
                    'https://pipedapi.yt.privacyredirect.com',
                    'https://pipedapi.projectsegfau.lt'
                ];

                for (const instance of pipedInstances) {
                    try {
                        const resData = await fetchWithTimeout(`${instance}/streams/${videoId}`, {
                            headers: { 'User-Agent': 'Mozilla/5.0' }
                        }, { timeout: 2500 });
                        
                        const json = await resData.json();
                        const streams = type === 'audio' ? json.audioStreams : json.videoStreams;
                        if (streams && streams.length > 0) {
                            const stream = streams.find(s => s.url) || streams[0];
                            if (stream && stream.url) {
                                console.log(`🚀 [TIER 2 SUCCESS] Extracted via Piped instance: ${instance}`);
                                return res.json({
                                    success: true,
                                    title: json.title || 'KINGBOT Media Download',
                                    downloadUrl: stream.url
                                });
                            }
                        }
                    } catch (e) {
                        // Skip to next Piped instance
                    }
                }
            }

            // --- TIER 3: Exhaustive Local yt-dlp Client Disguise & Impersonation Matrix ---
            console.log("🔄 [TIER 3] Gateways & Piped busy. Deploying local client disguise army...");
            const clientStrategies = [
                { client: 'android', skip: 'webpage' },
                { client: 'ios', skip: 'configs,js' },
                { client: 'tv_embedded', skip: '' },
                { client: 'mweb', skip: '' },
                { client: 'web', skip: '' },
                { client: 'creator', skip: '' }
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

                    console.log(`🎯 [CLIENT MATRIX] Testing client disguise: ${strat.client}`);
                    await execPromise(dlCmd, { maxBuffer: 1024 * 1024 * 50 });

                    const files = fs.readdirSync('/tmp');
                    downloadedFile = files.find(f => f.startsWith(`${fileId}_`));

                    if (downloadedFile) {
                        console.log(`👑 [BREAKTHROUGH] Success using client disguise: ${strat.client}`);
                        localSuccess = true;
                        break;
                    }
                } catch (stratErr) {
                    lastError = stratErr.stderr || stratErr.message;
                }
            }

            if (!localSuccess && !downloadedFile) {
                throw new Error("All public mirrors, Piped instances, and local client disguise strategies exhausted.");
            }

        } else {
            // Universal engine for Audiomack, TikTok, Instagram, Facebook, etc.
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
            error: `Failed to extract direct stream: ${lastError || 'Platform restriction'}` 
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

app.listen(PORT, () => console.log(`Kingbot God-Mode Ultimate API running on port ${PORT}`));
