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
    const { timeout = 8000 } = options;
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

    try {
        if (url.includes('youtube.com') || url.includes('youtu.be')) {
            console.log("Deploying ultimate YouTube bypass matrix...");

            // Exhaustive list of advanced combination arguments to bypass signature and bot challenges
            const bypassStrategies = [
                // Strategy 1: iOS client with skipped web configs & TLS impersonation
                {
                    args: `--impersonate chrome --extractor-args "youtube:player_client=ios;player_skip=configs,js" --geo-bypass`,
                    desc: "iOS Client + Skip Configs"
                },
                // Strategy 2: Android client with forced web client fallback skip
                {
                    args: `--impersonate chrome --extractor-args "youtube:player_client=android;player_skip=webpage" --geo-bypass`,
                    desc: "Android Client + Skip Webpage"
                },
                // Strategy 3: TV Embedded client disguise
                {
                    args: `--impersonate chrome --extractor-args "youtube:player_client=tv_embedded" --geo-bypass`,
                    desc: "TV Embedded Disguise"
                },
                // Strategy 4: MWeb mobile client bypass
                {
                    args: `--impersonate chrome --extractor-args "youtube:player_client=mweb" --geo-bypass`,
                    desc: "Mobile Web Disguise"
                },
                // Strategy 5: Raw default with strict no-check-certificates and user-agent spoofing
                {
                    args: `--user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" --no-check-certificates --geo-bypass`,
                    desc: "Standard Browser UA Spoof"
                }
            ];

            let success = false;

            for (const strategy of bypassStrategies) {
                try {
                    let dlCmd = '';
                    if (type === 'audio') {
                        dlCmd = `yt-dlp ${cookiesFlag} ${strategy.args} -x --audio-format mp3 -o "${outputTemplate}" "${url}"`;
                    } else {
                        dlCmd = `yt-dlp ${cookiesFlag} ${strategy.args} -f "best[ext=mp4]/best/b" -o "${outputTemplate}" "${url}"`;
                    }

                    console.log(`Trying strategy: ${strategy.desc}`);
                    await execPromise(dlCmd, { maxBuffer: 1024 * 1024 * 50 });

                    const files = fs.readdirSync('/tmp');
                    downloadedFile = files.find(f => f.startsWith(`${fileId}_`));

                    if (downloadedFile) {
                        console.log(`Success using strategy: ${strategy.desc}`);
                        success = true;
                        break;
                    }
                } catch (stratErr) {
                    lastError = stratErr.stderr || stratErr.message;
                    console.warn(`Strategy [${strategy.desc}] failed.`);
                }
            }

            // If all local exhaustive strategies fail due to cloud IP ASN blacklisting, fallback to public extractors
            if (!success) {
                console.log("Local exhaustive strategies blocked. Falling back to public gateway relays...");
                const gateways = [
                    'https://co.wuk.sh/api/json',
                    'https://api.cobalt.tools/api/json'
                ];

                for (const endpoint of gateways) {
                    try {
                        const apiRes = await fetchWithTimeout(endpoint, {
                            method: 'POST',
                            headers: {
                                'Accept': 'application/json',
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                url: url,
                                isAudioOnly: type === 'audio'
                            })
                        }, { timeout: 7000 });
                        
                        const apiData = await apiRes.json();
                        if (apiData && apiData.url) {
                            return res.json({
                                success: true,
                                title: apiData.filename || 'KINGBOT Media Download',
                                downloadUrl: apiData.url
                            });
                        }
                    } catch (e) {
                        console.warn(`Gateway proxy ${endpoint} unreachable.`);
                    }
                }
                throw new Error("All local bypass mechanisms and gateway relays exhausted.");
            }
        } else {
            // Local processing for Audiomack, TikTok, Instagram, etc.
            let dlCmd = '';
            if (type === 'audio') {
                dlCmd = `yt-dlp ${cookiesFlag} -x --audio-format mp3 -o "${outputTemplate}" --no-check-certificates "${url}"`;
            } else {
                dlCmd = `yt-dlp ${cookiesFlag} -f "best[ext=mp4]/best/b" -o "${outputTemplate}" --no-check-certificates "${url}"`;
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
