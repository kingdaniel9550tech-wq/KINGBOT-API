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

// Serve downloaded media files statically from /tmp
app.use('/media', express.static('/tmp'));

if (!fs.existsSync('/tmp')) {
    fs.mkdirSync('/tmp', { recursive: true });
}

// Automatically decode and create /tmp/cookies.txt from Railway Base64 Environment Variable
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

// Multi-Platform Downloader Endpoint
app.post('/download', async (req, res) => {
    const { url, type } = req.body; 
    if (!url) return res.status(400).json({ success: false, error: 'URL is required' });

    const fileId = Date.now();
    const outputTemplate = `/tmp/${fileId}_%(id)s.%(ext)s`;

    let downloadedFile = null;
    let lastError = null;

    const cookiesFlag = fs.existsSync(cookiesPath) ? `--cookies "${cookiesPath}"` : '';
    const ejsFlag = '--remote-components ejs:github';

    try {
        if (url.includes('youtube.com') || url.includes('youtu.be')) {
            const clients = ['default', 'android', 'web', 'ios', 'mweb'];
            let success = false;

            for (const client of clients) {
                try {
                    let dlCmd = '';
                    if (type === 'audio') {
                        dlCmd = `yt-dlp ${cookiesFlag} ${ejsFlag} --extractor-args "youtube:player_client=${client}" -x --audio-format mp3 -o "${outputTemplate}" --no-check-certificates "${url}"`;
                    } else {
                        dlCmd = `yt-dlp ${cookiesFlag} ${ejsFlag} --extractor-args "youtube:player_client=${client}" -f "best[ext=mp4]/best/b" -o "${outputTemplate}" --no-check-certificates "${url}"`;
                    }

                    const { stderr } = await execPromise(dlCmd, { maxBuffer: 1024 * 1024 * 50 });

                    const files = fs.readdirSync('/tmp');
                    downloadedFile = files.find(f => f.startsWith(`${fileId}_`));

                    if (downloadedFile) {
                        success = true;
                        break;
                    }
                } catch (clientErr) {
                    lastError = clientErr.stderr || clientErr.message;
                    console.warn(`Client [${client}] attempt failed: ${lastError}`);
                }
            }

            if (!success) {
                throw new Error(`All YouTube client bypass attempts failed. Last error: ${lastError}`);
            }
        } else {
            // Multi-platform support for Audiomack, TikTok, Instagram, Facebook, etc.
            let dlCmd = '';
            if (type === 'audio') {
                dlCmd = `yt-dlp ${cookiesFlag} -x --audio-format mp3 -o "${outputTemplate}" --no-check-certificates "${url}"`;
            } else {
                dlCmd = `yt-dlp ${cookiesFlag} -f "best[ext=mp4]/best/b" -o "${outputTemplate}" --no-check-certificates "${url}"`;
            }

            const { stderr } = await execPromise(dlCmd, { maxBuffer: 1024 * 1024 * 50 });

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
            error: `Download failed: ${lastError || 'Platform restriction or invalid URL'}` 
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

// YouTube Search Endpoint
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
