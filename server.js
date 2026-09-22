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

// Universal Downloader Endpoint (Supports YouTube, TikTok, Audiomack, etc.)
app.post('/download', async (req, res) => {
    const { url, type } = req.body; 
    if (!url) return res.status(400).json({ success: false, error: 'URL is required' });

    const fileId = Date.now();
    const outputTemplate = `/tmp/${fileId}_%(id)s.%(ext)s`;

    // Check if the link is YouTube to decide whether to use client rotation
    const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');
    const clients = isYouTube ? ['android', 'mweb', 'web'] : [null]; 

    let success = false;
    let mediaTitle = 'KINGBOT Media';
    let mediaThumbnail = '';
    let downloadedFile = null;
    let lastError = null;

    for (const client of clients) {
        try {
            const clientArg = client ? `--extractor-args "youtube:player_client=${client}"` : '';

            // 1. Fetch metadata safely
            const metaCmd = `yt-dlp --dump-json --no-check-certificates ${clientArg} "${url}"`;
            const { stdout: metaStdout } = await execPromise(metaCmd, { maxBuffer: 1024 * 1024 * 10 });
            const meta = JSON.parse(metaStdout);
            mediaTitle = meta.title || meta.description || mediaTitle;
            mediaThumbnail = meta.thumbnail || '';

            // 2. Download file based on platform type
            let dlCmd = '';
            if (isYouTube && type === 'audio') {
                dlCmd = `yt-dlp -x --audio-format mp3 ${clientArg} -o "${outputTemplate}" --no-check-certificates "${url}"`;
            } else if (isYouTube) {
                dlCmd = `yt-dlp -f "best[ext=mp4]/best" ${clientArg} -o "${outputTemplate}" --no-check-certificates "${url}"`;
            } else {
                // Universal handler for TikTok, Audiomack, Instagram, etc.
                dlCmd = `yt-dlp -o "${outputTemplate}" --no-check-certificates "${url}"`;
            }

            await execPromise(dlCmd, { maxBuffer: 1024 * 1024 * 50 });

            const files = fs.readdirSync('/tmp');
            downloadedFile = files.find(f => f.startsWith(`${fileId}_`));

            if (downloadedFile) {
                success = true;
                break;
            }
        } catch (err) {
            lastError = err.message;
        }
    }

    if (!success || !downloadedFile) {
        return res.status(500).json({ 
            success: false, 
            error: `Download failed: ${lastError || 'Platform blocked the request'}` 
        });
    }

    const host = req.get('host');
    const protocol = req.protocol;
    const downloadUrl = `${protocol}://${host}/media/${downloadedFile}`;

    res.json({
        success: true,
        title: mediaTitle,
        thumbnail: mediaThumbnail,
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

app.listen(PORT, () => console.log(`Kingbot API running on port ${PORT}`));
