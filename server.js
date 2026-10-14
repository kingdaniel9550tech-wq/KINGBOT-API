const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const yts = require('yt-search');
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core'); // Requires chromium binary or buildpacks supporting it

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

// Browser Simulation Fallback using Puppeteer
async function simulateBrowserExtraction(targetUrl) {
    let browser = null;
    try {
        // Look for system Chromium path common in Docker/Linux containers
        const executablePath = process.env.CHROME_BIN || '/usr/bin/google-chrome' || '/usr/bin/chromium-browser';
        
        browser = await puppeteer.launch({
            executablePath,
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process', 
                '--disable-gpu'
            ]
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        let interceptedStreamUrl = null;

        // Intercept network requests to capture direct media/audio payloads
        await page.requestInterception(true);
        page.on('request', interceptedRequest => {
            const reqUrl = interceptedRequest.url();
            if ((reqUrl.includes('.googlevideo.com/videoplayback') || reqUrl.includes('audio/mp4') || reqUrl.includes('mime=audio')) && !interceptedStreamUrl) {
                interceptedStreamUrl = reqUrl;
            }
            interceptedRequest.continue();
        });

        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 15000 });
        
        // Give it a brief moment to sniff media requests
        await new Promise(resolve => setTimeout(resolve, 3000));

        await browser.close();
        return interceptedStreamUrl;
    } catch (err) {
        if (browser) await browser.close();
        console.error("Browser simulation error:", err.message);
        return null;
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
            console.log("🛡️ [BROWSER-MODE] Initializing multi-tier extraction & browser simulation...");

            // 1. Try Public Gateways first
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
                    }, { timeout: 2500 });
                    
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

            // 2. Try Browser Simulation Sniffing via Puppeteer
            console.log("🌐 Gateways busy. Launching headless browser simulation engine...");
            const browserStream = await simulateBrowserExtraction(url);
            if (browserStream) {
                return res.json({
                    success: true,
                    title: 'KINGBOT Browser Extracted Media',
                    downloadUrl: browserStream
                });
            }

            // 3. Fallback to Local Client Matrix Army
            console.log("🔄 Browser sniffing blocked. Deploying local client disguise army...");
            const clientStrategies = [{ client: 'android', skip: 'webpage' }, { client: 'ios', skip: 'configs,js' }, { client: 'tv_embedded', skip: '' }];

            let localSuccess = false;
            for (const strat of clientStrategies) {
                try {
                    const skipArg = strat.skip ? `,player_skip=${strat.skip}` : '';
                    let dlCmd = type === 'audio' 
                        ? `yt-dlp ${cookiesFlag} ${proxyFlag} --impersonate chrome --extractor-args "youtube:player_client=${strat.client}${skipArg}" -x --audio-format mp3 -o "${outputTemplate}" --no-check-certificates "${url}"`
                        : `yt-dlp ${cookiesFlag} ${proxyFlag} --impersonate chrome --extractor-args "youtube:player_client=${strat.client}${skipArg}" -f "best[ext=mp4]/best/b" -o "${outputTemplate}" --no-check-certificates "${url}"`;

                    await execPromise(dlCmd, { maxBuffer: 1024 * 1024 * 50 });
                    const files = fs.readdirSync('/tmp');
                    downloadedFile = files.find(f => f.startsWith(`${fileId}_`));

                    if (downloadedFile) {
                        localSuccess = true;
                        break;
                    }
                } catch (stratErr) {
                    lastError = stratErr.stderr || stratErr.message;
                }
            }

            if (!localSuccess && !downloadedFile) {
                return res.json({
                    success: false,
                    error: "YouTube streaming gateways and browser simulation are temporarily restricted."
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
        return res.json({ 
            success: false, 
            error: `Download failed: Platform restriction.` 
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
            success:/true/,
            title: video.title,
            url: video.url,
            thumbnail: video.thumbnail,
            duration: video.timestamp
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.listen(PORT, () => console.log(`Kingbot Browser-Simulated API running on port ${PORT}`));
