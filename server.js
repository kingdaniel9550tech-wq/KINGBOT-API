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
    const { timeout = 9000 } = options;
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
            console.log("Executing ultimate multi-instance proxy & client rotation matrix...");

            // 1. Multi-instance public extraction relay rotation (Cobalt mirrors)
            const extractionGateways = [
                'https://co.wuk.sh/api/json',
                'https://api.cobalt.tools/api/json',
                'https://co.projectlization.com/api/json',
                'https://cobalt.kike.wtf/api/json'
            ];

            let gatewaySuccess = false;
            for (const gateway of extractionGateways) {
                try {
                    console.log(`Trying extraction relay: ${gateway}`);
                    const apiRes = await fetchWithTimeout(gateway, {
                        method: 'POST',
                        headers: {
                            'Accept': 'application/json',
                            'Content-Type': 'application/json',
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        },
                        body: JSON.stringify({
                            url: url,
                            isAudioOnly: type === 'audio'
                        })
                    }, { timeout: 7000 });
                    
                    const apiData = await apiRes.json();
                    if (apiData && (apiData.url || apiData.picker)) {
                        const directUrl = apiData.url || (apiData.picker && apiData.picker[0]?.url);
                        if (directUrl) {
                            console.log(`Successfully extracted via relay: ${gateway}`);
                            return res.json({
                                success: true,
                                title: apiData.filename || apiData.text || 'KINGBOT Media Download',
                                downloadUrl: directUrl
                            });
                        }
                    }
                } catch (relayErr) {
                    console.warn(`Relay ${gateway} failed: ${relayErr.message}`);
                }
            }

            // 2. Exhaustive local yt-dlp client & disguise matrix fallback
            console.log("Relays exhausted. Falling back to exhaustive local yt-dlp client matrix...");
            const clientStrategies = [
                { client: 'ios', skip: 'configs,js' },
                { client: 'android', skip: 'webpage' },
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

                    console.log(`Trying local strategy -> Client: ${strat.client}`);
                    await execPromise(dlCmd, { maxBuffer: 1024 * 1024 * 50 });

                    const files = fs.readdirSync('/tmp');
                    downloadedFile = files.find(f => f.startsWith(`${fileId}_`));

                    if (downloadedFile) {
                        console.log(`Local strategy succeeded with client: ${strat.client}`);
                        localSuccess = true;
                        break;
                    }
                } catch (stratErr) {
                    lastError = stratErr.stderr || stratErr.message;
                }
            }

            if (!localSuccess && !downloadedFile) {
                throw new Error("All extraction relays, client rotations, and disguise strategies were blocked or timed out.");
            }
        } else {
            // Local processing for Audiomack, TikTok, Instagram, etc.
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

app.listen(PORT, () => console.log(`Kingbot Docker API running on port ${PORT}`));
