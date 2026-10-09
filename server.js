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

app.post('/download', async (req, res) => {
    const { url, type } = req.body; 
    if (!url) return res.status(400).json({ success: false, error: 'URL is required' });

    const fileId = Date.now();
    const outputTemplate = `/tmp/${fileId}_%(id)s.%(ext)s`;

    let downloadedFile = null;
    let lastError = null;

    const cookiesFlag = fs.existsSync(cookiesPath) ? `--cookies "${cookiesPath}"` : '';

    try {
        // Handle YouTube via robust extraction routing to avoid Railway data center IP blocks
        if (url.includes('youtube.com') || url.includes('youtu.be')) {
            console.log("Processing YouTube link via extraction proxy...");
            try {
                const apiRes = await fetch('https://co.wuk.sh/api/json', {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        url: url,
                        isAudioOnly: type === 'audio'
                    })
                });
                const apiData = await apiRes.json();
                if (apiData && apiData.url) {
                    return res.json({
                        success: true,
                        title: apiData.filename || 'KINGBOT Media Download',
                        downloadUrl: apiData.url
                    });
                }
            } catch (proxyErr) {
                console.warn("Primary proxy route failed, trying secondary endpoint:", proxyErr.message);
            }

            // Secondary fallback proxy
            try {
                const cobaltRes = await fetch('https://api.cobalt.tools/api/json', {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        url: url,
                        isAudioOnly: type === 'audio'
                    })
                });
                const cobaltData = await cobaltRes.json();
                if (cobaltData && cobaltData.url) {
                    return res.json({
                        success: true,
                        title: cobaltData.filename || 'KINGBOT Media Download',
                        downloadUrl: cobaltData.url
                    });
                }
            } catch (secondaryErr) {
                throw new Error("All YouTube proxy channels blocked by datacenter IP restrictions.");
            }
        } else {
            // Local processing for Audiomack, TikTok, Instagram, Facebook, etc.
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

    if (!downloadedFile && !url.includes('youtube.com') && !url.includes('youtu.be')) {
        return res.status(500).json({ 
            success: false, 
            error: `Download failed: ${lastError || 'Platform restriction or invalid URL'}` 
        });
    }

    if (downloadedFile) {
        const host = req.get('host');
        const protocol = req.protocol;
        const downloadUrl = `${protocol}://${host}/media/${downloadedFile}`;

        return res.json({
            success: true,
            title: 'KINGBOT Media Download',
            downloadUrl: downloadUrl
        });
    }
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
