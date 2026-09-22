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

// Ensure /tmp directory exists
if (!fs.existsSync('/tmp')) {
    fs.mkdirSync('/tmp', { recursive: true });
}

// Downloader Endpoint: Downloads locally on server to bypass YouTube 403 IP mismatch
app.post('/download', async (req, res) => {
    const { url, type } = req.body; 
    if (!url) return res.status(400).json({ success: false, error: 'URL is required' });

    const fileId = Date.now();
    const outputTemplate = `/tmp/${fileId}_%(id)s.%(ext)s`;

    let videoTitle = 'KINGBOT Media';
    let videoThumbnail = '';

    // Fetch metadata first
    try {
        const { stdout } = await execPromise(`yt-dlp --dump-json --no-check-certificates "${url}"`);
        const meta = JSON.parse(stdout);
        videoTitle = meta.title || videoTitle;
        videoThumbnail = meta.thumbnail || videoThumbnail;
    } catch (e) {
        // Fallback if metadata fetch fails
    }

    // Download file locally using yt-dlp
    let cmd = '';
    if (type === 'audio') {
        cmd = `yt-dlp -x --audio-format mp3 -o "${outputTemplate}" --no-check-certificates "${url}"`;
    } else {
        cmd = `yt-dlp -f "best[ext=mp4]/best" -o "${outputTemplate}" --no-check-certificates "${url}"`;
    }

    try {
        await execPromise(cmd, { maxBuffer: 1024 * 1024 * 50 });

        // Find the generated file in /tmp
        const files = fs.readdirSync('/tmp');
        const downloadedFile = files.find(f => f.startsWith(`${fileId}_`));

        if (!downloadedFile) {
            return res.status(500).json({ success: false, error: 'File download failed on server' });
        }

        const host = req.get('host');
        const protocol = req.protocol;
        const downloadUrl = `${protocol}://${host}/media/${downloadedFile}`;

        res.json({
            success: true,
            title: videoTitle,
            thumbnail: videoThumbnail,
            downloadUrl: downloadUrl
        });

    } catch (err) {
        res.status(500).json({ success: false, error: `Download failed: ${err.message}` });
    }
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
