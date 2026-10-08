const express = require('express');
const cors = require('cors');
const axios = require('axios');
const yts = require('yt-search');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

// Multi-Platform Downloader Endpoint (Powered by reliable gateway, immune to cloud IP blocks)
app.post('/download', async (req, res) => {
    const { url, type } = req.body; 
    if (!url) return res.status(400).json({ success: false, error: 'URL is required' });

    try {
        const isAudio = type === 'audio';
        
        // Request media link from high-availability extraction gateway
        const response = await axios.post('https://api.cobalt.tools/api/json', {
            url: url,
            isAudioOnly: isAudio,
            aFormat: 'mp3',
            videoQuality: '720'
        }, {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 30000
        });

        const data = response.data;

        if (data.status === 'redirect' || data.status === 'stream' || data.status === 'picker') {
            const downloadUrl = data.url || (data.picker && data.picker[0]?.url);
            const title = data.filename || 'KINGBOT Media Download';

            if (downloadUrl) {
                return res.json({
                    success: true,
                    title: title,
                    downloadUrl: downloadUrl
                });
            }
        }

        throw new Error(data.text || 'Failed to retrieve media link from downloader service.');

    } catch (err) {
        const errorMsg = err.response?.data?.text || err.message || 'Platform restriction or invalid URL';
        console.error("Downloader execution error:", errorMsg);
        return res.status(500).json({ 
            success: false, 
            error: `Download failed: ${errorMsg}` 
        });
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
