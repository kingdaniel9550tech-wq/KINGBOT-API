const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const yts = require('yt-search');
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

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
    const { timeout = 2500 } = options;
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

// Safely isolated browser simulation
async function simulateBrowserExtraction(targetUrl) {
    let browser = null;
    try {
        const executablePath = process.env.CHROME_BIN || '/usr/bin/chromium';
        
        browser = await puppeteer.launch({
            executablePath,
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu',
                '--disable-software-rasterizer',
                '--disable-extensions',
                '--disable-features=AudioServiceOutOfProcess'
            ]
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        let interceptedStreamUrl = null;

        await page.setRequestInterception(true);
        page.on('request', interceptedRequest => {
            const reqUrl = interceptedRequest.url();
            if ((reqUrl.includes('.googlevideo.com/videoplayback') || reqUrl.includes('mime=audio') || reqUrl.includes('mime=video')) && !interceptedStreamUrl) {
                interceptedStreamUrl = reqUrl;
            }
            interceptedRequest.continue();
        });

        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
        await new Promise(resolve => setTimeout(resolve, 2000));

        await browser.close();
        return interceptedStreamUrl;
    } catch (err) {
        if (browser) await browser.close();
        console.log("Browser simulation safely bypassed:", err.message);
        return null; // Gracefully fallback instead of crashing
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
            console.log("🛡️ [YOUTUBE] Processing request...");

            // 1. Public Gateways
            const gateways = [
                'https://api.cobalt.tools/api/json',
                'https://co.wuk.sh/api/json',
                'https://co.projectlization.com/api/json'
            ];

            let successUrl = null;
            let mediaTitle = 'KINGBOT Media Download';

            for (const gateway of gateways) {
                try {
                    const apiRes = await fetchWithTimeout(gateway, {
                        method: 'POST',
                        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
                        body: JSON.stringify({ url: url, isAudioOnly: type === 'audio' })
                    }, { timeout: 2000 });
                    
                    const apiData = await apiRes.json();
                    const directUrl = apiData.url || (apiData.picker && apiData.picker[0]?.url);
                    if (directUrl) {
                        successUrl = directUrl;
                        mediaTitle = apiData.filename || apiData.text || mediaTitle;
                        break;
                    }
                } catch (e) {}
            }

            if (successUrl) {
                return res.json({ success: true, title: mediaTitle, downloadUrl: successUrl });
            }

            // 2. Safe Browser Simulation Attempt
            const browserStream = await simulateBrowserExtraction(url);
            if (browserStream) {
                return res.json({
                    success: true,
                    title: 'KINGBOT Browser Stream',
                    downloadUrl: browserStream
                });
            }

            // 3. Local yt-dlp Client Matrix Army Fallback
            console.log("🔄 Deploying local client disguise matrix...");
            const clientStrategies = [{ client: 'android', skip: 'webpage' }, { client: 'ios', skip: 'configs,js' }, { client: 'tv_embedded', skip: '' }, { client: 'web', skip: '' }];

            for (const strat of clientStrategies) {
                try {
                    const skipArg = strat.skip ? `,player_skip=${strat.skip}` : '';
                    let dlCmd = type === 'audio' 
                        ? `yt-dlp ${cookiesFlag} ${proxyFlag} --impersonate chrome --extractor-args "youtube:player_client=${strat.client}${skipArg}" -x --audio-format mp3 -o "${outputTemplate}" --no-check-certificates "${url}"`
                        : `yt-dlp ${cookiesFlag} ${proxyFlag} --impersonate chrome --extractor-args "youtube:player_client=${strat.client}${skipArg}" -f "best[ext=mp4]/best/b" -o "${outputTemplate}" --no-check-certificates "${url}"`;

                    await execPromise(dlCmd, { maxBuffer: 1024 * 1024 * 50 });
                    const files = fs.readdirSync('/tmp');
                    downloadedFile = files.find(f => f.startsWith(`${fileId}_`));

                    if (downloadedFile) break;
                } catch (stratErr) {
                    lastError = stratErr.stderr || stratErr.message;
                }
            }

        } else {
            // Universal engine for Audiomack, Instagram, Facebook, TikTok, etc.
            console.log("📥 [UNIVERSAL] Processing media download...");
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
        return res.json({ 
            success: false, 
            error: `Failed to extract direct stream.` 
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
