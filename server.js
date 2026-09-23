const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const util = require('util');
const execFilePromise = util.promisify(execFile);
const yts = require('yt-search');
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

// Universal Downloader Endpoint
app.post('/download', async (req, res) => {
    const { url, type } = req.body; 
    if (!url) {
        return res.status(200).json({ success: false, error: 'URL is required' });
    }

    const fileId = Date.now();
    const outputTemplate = `/tmp/${fileId}_%(id)s.%(ext)s`;
    const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');

    try {
        // 1. Fetch metadata safely
        const metaArgs = ['--no-check-certificates', '--dump-json', url];
        if (isYouTube) {
            metaArgs.push('--extractor-args', 'youtube:player_client=android');
        }

        const { stdout } = await execFilePromise('yt-dlp', metaArgs, { maxBuffer: 1024 * 1024 * 10 });
        const meta = JSON.parse(stdout);
        const mediaTitle = meta.title || meta.description || 'KINGBOT Media';
        const mediaThumbnail = meta.thumbnail || '';

        // 2. Download file safely
        let dlArgs = [];
        if (isYouTube) {
            if (type === 'audio') {
                dlArgs = ['-x', '--audio-format', 'mp3', '--extractor-args', 'youtube:player_client=android', '-o', outputTemplate, '--no-check-certificates', url];
            } else {
                dlArgs = ['-f', 'best[ext=mp4]/best', '--extractor-args', 'youtube:player_client=android', '-o', outputTemplate, '--no-check-certificates', url];
            }
        } else {
            dlArgs = ['-o', outputTemplate, '--no-check-certificates', url];
        }

        await execFilePromise('yt-dlp', dlArgs, { maxBuffer: 1024 * 1024 * 50 });

        const files = fs.readdirSync('/tmp');
        const downloadedFile = files.find(f => f.startsWith(`${fileId}_`));

        if (!downloadedFile) {
            return res.status(200).json({ success: false, error: 'File generation failed: File not found in /tmp' });
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

    } catch (err) {
        console.error('Download Error:', err);
        const exactError = err.stderr || err.message || 'Unknown server execution error';
        res.status(200).json({ 
            success: false, 
            error: exactError.trim()
        });
    }
});

// YouTube Search Endpoint
app.get('/search', async (req, res) => {
    const query = req.query.q;
    if (!query) return res.status(200).json({ success: false, error: 'Query is required' });

    try {
        const searchResult = await yts(query);
        const video = searchResult.videos[0];
        if (!video) return res.status(200).json({ success: false, error: 'No results found' });

        res.json({
            success: true,
            title: video.title,
            url: video.url,
            thumbnail: video.thumbnail,
            duration: video.timestamp
        });
    } catch (err) {
        res.status(200).json({ success: false, error: err.code || err.message });
    }
});

app.listen(PORT, () => console.log(`Kingbot API running on port ${PORT}`));
