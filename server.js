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

// Self-Healing: Force upgrade/install yt-dlp via pip on startup to guarantee latest anti-bot patches
async function updateYtDlp() {
    try {
        console.log("Installing/Upgrading yt-dlp via pip to latest release...");
        await execPromise('pip install --upgrade yt-dlp || python3 -m pip install --upgrade yt-dlp');
        console.log("yt-dlp successfully updated to latest version.");
    } catch (err) {
        console.warn("Pip upgrade failed, attempting binary update:", err.message);
        try {
            await execPromise('yt-dlp -U');
        } catch (e) {}
    }
}
updateYtDlp();

// Multi-Platform Downloader Endpoint
app.post('/download', async (req, res) => {
    const { url, type } = req.body; 
    if (!url) return res.status(400).json({ success: false, error: 'URL is required' });

    const fileId = Date.now();
    const outputTemplate = `/tmp/${fileId}_%(id)s.%(ext)s`;

    let downloadedFile = null;
    let lastError = null;

    try {
        if (url.includes('youtube.com') || url.includes('youtu.be')) {
            // Expanded resilient client list including TV and embedded clients which bypass cloud DC blocks
            const clients = ['tv', 'android', 'tv_embedded', 'web', 'ios', 'mweb', 'default'];
            let success = false;

            for (const client of clients) {
                try {
                    let dlCmd = '';
                    if (type === 'audio') {
                        dlCmd = `yt-dlp --extractor-args "youtube:player_client=${client}" -x --audio-format mp3 -o "${outputTemplate}" --no-check-certificates "${url}"`;
                    } else {
                        dlCmd = `yt-dlp --extractor-args "youtube:player_client=${client}" -f "best[ext=mp4]/best/b" -o "${outputTemplate}" --no-check-certificates "${url}"`;
                    }

                    await execPromise(dlCmd, { maxBuffer: 1024 * 1024 * 50 });

                    const files = fs.readdirSync('/tmp');
                    downloadedFile = files.find(f => f.startsWith(`${fileId}_`));

                    if (downloadedFile) {
                        success = true;
                        console.log(`Successfully downloaded using YouTube client: [${client}]`);
                        break;
                    }
                } catch (clientErr) {
                    console.warn(`Client [${client}] attempt failed, trying next...`);
                }
            }

            // Ultimate Fallback: Generic download with full browser User-Agent spoofing
            if (!success) {
                console.log("All clients failed, trying generic browser-spoofed fallback...");
                try {
                    let fallbackCmd = type === 'audio'
                        ? `yt-dlp -x --audio-format mp3 -o "${outputTemplate}" --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" --no-check-certificates "${url}"`
                        : `yt-dlp -f "best[ext=mp4]/best/b" -o "${outputTemplate}" --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" --no-check-certificates "${url}"`;

                    await execPromise(fallbackCmd, { maxBuffer: 1024 * 1024 * 50 });

                    const files = fs.readdirSync('/tmp');
                    downloadedFile = files.find(f => f.startsWith(`${fileId}_`));
                } catch (fallbackErr) {
                    lastError = fallbackErr.stderr || fallbackErr.message;
                }
            }

        } else {
            // Multi-platform support for TikTok, Instagram, Facebook, Audiomack, etc.
            let dlCmd = '';
            if (type === 'audio') {
                dlCmd = `yt-dlp -x --audio-format mp3 -o "${outputTemplate}" --no-check-certificates "${url}"`;
            } else {
                dlCmd = `yt-dlp -f "best[ext=mp4]/best/b" -o "${outputTemplate}" --no-check-certificates "${url}"`;
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
