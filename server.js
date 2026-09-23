const express = require('express');
const cors = require('cors');
const yts = require('yt-search');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

// Universal Downloader Endpoint
app.post('/download', async (req, res) => {
    const { url, type } = req.body; 
    if (!url) {
        return res.status(200).json({ success: false, error: 'URL is required' });
    }

    try {
        const response = await fetch('https://api.cobalt.tools/api/json', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0'
            },
            body: JSON.stringify({
                url: url,
                audioFormat: type === 'audio' ? 'mp3' : 'best',
                downloadMode: type === 'audio' ? 'audio' : 'auto'
            })
        });

        const data = await response.json();

        if (data.status === 'redirect' || data.status === 'tunnel' || data.url) {
            return res.json({
                success: true,
                title: data.filename || 'KINGBOT Media',
                thumbnail: data.thumbnail || '',
                downloadUrl: data.url || data.picker?.[0]?.url
            });
        } else {
            return res.status(200).json({ 
                success: false, 
                error: data.text || data.error?.code || 'Failed to extract media stream' 
            });
        }

    } catch (err) {
        console.error('Download Error:', err);
        return res.status(200).json({ 
            success: false, 
            error: err.message || 'Server connection error'
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
        res.status(200).json({ success: false, error: err.message });
    }
});

app.listen(PORT, () => console.log(`Kingbot API running on port ${PORT}`));
