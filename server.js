const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const yts = require('yt-search');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

// Universal Downloader Endpoint using Native yt-dlp Binary
app.post('/download', async (req, res) => {
    const { url, type } = req.body; 
    if (!url) return res.status(400).json({ success: false, error: 'URL is required' });

    // Rotate through mobile and web clients to bypass restrictions
    const clients = ['android', 'ios', 'mweb', 'web'];
    let outputData = null;
    let lastError = null;

    for (const client of clients) {
        try {
            const cmd = `yt-dlp --dump-json --no-check-certificates --prefer-free-formats --extractor-args "youtube:player_client=${client}" "${url}"`;
            const { stdout } = await execPromise(cmd, { maxBuffer: 1024 * 1024 * 10 });
            outputData = JSON.parse(stdout);
            if (outputData) break;
        } catch (err) {
            lastError = err.message;
        }
    }

    if (!outputData) {
        return res.status(500).json({ 
            success: false, 
            error: `Download failed: ${lastError || 'YouTube blocked the request'}` 
        });
    }

    try {
        let mediaUrl = '';
        if (type === 'audio') {
            const audioFormat = outputData.formats?.reverse().find(f => f.acodec !== 'none' && f.vcodec === 'none');
            mediaUrl = audioFormat ? audioFormat.url : outputData.url;
        } else {
            const videoFormat = outputData.formats?.reverse().find(f => f.vcodec !== 'none' && f.acodec !== 'none' && f.ext === 'mp4');
            mediaUrl = videoFormat ? videoFormat.url : (outputData.url || outputData.formats?.[0]?.url);
        }

        if (!mediaUrl) mediaUrl = outputData.url;

        res.json({
            success: true,
            title: outputData.title || 'KINGBOT Media',
            thumbnail: outputData.thumbnail || '',
            downloadUrl: mediaUrl
        });

    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
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
