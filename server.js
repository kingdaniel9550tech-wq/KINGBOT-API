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

if (!fs.existsSync('/tmp')) {
    fs.mkdirSync('/tmp', { recursive: true });
}

// Serve media file once, then automatically delete it from /tmp
app.get('/media/:filename', (req, res) => {
    const filename = path.basename(req.params.filename); // Prevent directory traversal
    const filePath = path.join('/tmp', filename);

    if (fs.existsSync(filePath)) {
        res.sendFile(filePath, (err) => {
            if (!err) {
                // Automatically delete the file after successful transmission
                fs.unlink(filePath, (unlinkErr) => {
                    if (unlinkErr) console.error('Failed to delete temporary file:', unlinkErr);
                });
            }
        });
    } else {
        res.status(404).json({ success: false, error: 'File not found or already deleted' });
    }
});

// Multi-Platform Downloader Endpoint (YouTube, TikTok, Facebook, Instagram, Audiomack, etc.)
app.post('/download', async (req, res) => {
    const { url, type } = req.body; 
    if (!url) return res.status(400).json({ success: false, error: 'URL is required' });

    const fileId = Date.now();
    const outputTemplate = `/tmp/${fileId}_%(id)s.%(ext)s`;

    let success = false;
    let videoTitle = 'KINGBOT Media';
    let videoThumbnail = '';
    let downloadedFile = null;
    let lastError = null;

    const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');

    if (isYouTube) {
        // 1. YouTube Client Rotation Logic
        const clients = ['android', 'mweb', 'web'];
        for (const client of clients) {
            try {
                const metaCmd = `yt-dlp --dump-json --no-check-certificates --extractor-args "youtube:player_client=${client}" "${url}"`;
                const { stdout: metaStdout } = await execPromise(metaCmd, { maxBuffer: 1024 * 1024 * 10 });
                const meta = JSON.parse(metaStdout);
                videoTitle = meta.title || videoTitle;
                videoThumbnail = meta.thumbnail || videoThumbnail;

                let dlCmd = '';
                if (type === 'audio') {
                    dlCmd = `yt-dlp -x --audio-format mp3 --extractor-args "youtube:player_client=${client}" -o "${outputTemplate}" --no-check-certificates "${url}"`;
                } else {
                    dlCmd = `yt-dlp -f "best[ext=mp4]/best" --extractor-args "youtube:player_client=${client}" -o "${outputTemplate}" --no-check-certificates "${url}"`;
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
    } else {
        // 2. Multi-Platform Logic (TikTok, IG, FB, Audiomack)
        try {
            const userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
            
            const metaCmd = `yt-dlp --dump-json --no-check-certificates --user-agent "${userAgent}" "${url}"`;
            const { stdout: metaStdout } = await execPromise(metaCmd, { maxBuffer: 1024 * 1024 * 10 });
            const meta = JSON.parse(metaStdout);
            videoTitle = meta.title || meta.description || videoTitle;
            videoThumbnail = meta.thumbnail || videoThumbnail;

            let dlCmd = '';
            if (type === 'audio') {
                dlCmd = `yt-dlp -x --audio-format mp3 --user-agent "${userAgent}" -o "${outputTemplate}" --no-check-certificates "${url}"`;
            } else {
                dlCmd = `yt-dlp --user-agent "${userAgent}" -o "${outputTemplate}" --no-check-certificates "${url}"`;
            }

            await execPromise(dlCmd, { maxBuffer: 1024 * 1024 * 50 });

            const files = fs.readdirSync('/tmp');
            downloadedFile = files.find(f => f.startsWith(`${fileId}_`));

            if (downloadedFile) {
                success = true;
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
        title: videoTitle,
        thumbnail: videoThumbnail,
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
