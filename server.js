const express = require('express');
const cors = require('cors');
const youtubedl = require('youtube-dl-exec');
const yts = require('yt-search');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

// Universal Downloader Endpoint with 403 Bypass & Client Rotation
app.post('/download', async (req, res) => {
    const { url, type } = req.body; 
    if (!url) return res.status(400).json({ success: false, error: 'URL is required' });

    // Rotate through mobile and web clients to bypass 403 blocks
    const clients = ['mweb', 'android', 'web'];
    let output = null;
    let lastError = null;

    for (const client of clients) {
        try {
            const flags = {
                dumpSingleJson: true,
                noCheckCertificates: true,
                noWarnings: true,
                preferFreeFormats: true,
                extractorArgs: `youtube:player_client=${client}`,
                addHeader: [
                    'user-agent: Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
                    'referer:https://www.youtube.com'
                ]
            };

            if (type === 'audio') {
                flags.extractAudio = true;
                flags.audioFormat = 'mp3';
            }

            output = await youtubedl(url, flags);
            if (output && (output.url || output.formats)) {
                break; // Successfully bypassed block
            }
        } catch (err) {
            lastError = err.message;
        }
    }

    if (!output) {
        return res.status(500).json({ 
            success: false, 
            error: `403 Bypass Failed: ${lastError || 'Stream restricted by YouTube'}` 
        });
    }

    try {
        let mediaUrl = '';
        if (type === 'audio') {
            const audioFormat = output.formats?.reverse().find(f => f.acodec !== 'none' && f.vcodec === 'none');
            mediaUrl = audioFormat ? audioFormat.url : output.url;
        } else {
            const videoFormat = output.formats?.reverse().find(f => f.vcodec !== 'none' && f.acodec !== 'none' && f.ext === 'mp4');
            mediaUrl = videoFormat ? videoFormat.url : (output.url || output.formats?.[0]?.url);
        }

        if (!mediaUrl) mediaUrl = output.url;

        res.json({
            success: true,
            title: output.title || 'KINGBOT Media',
            thumbnail: output.thumbnail || '',
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
