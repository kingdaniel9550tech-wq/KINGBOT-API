const express = require('express');
const cors = require('cors');
const yts = require('yt-search');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

// Universal Downloader Endpoint with complete Cobalt response mapping
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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            },
            body: JSON.stringify({
                url: url,
                audioFormat: type === 'audio' ? 'mp3' : 'best',
                downloadMode: type === 'audio' ? 'audio' : 'auto',
                filenameStyle: 'basic'
            })
        });

        const data = await response.json();
        console.log('Cobalt API Response:', data);

        let finalUrl = null;
        let title = data.filename || 'KINGBOT Media';

        if (data.status === 'redirect' || data.status === 'tunnel' || data.url) {
            finalUrl = data.url;
        } else if (data.status === 'picker' && data.picker && data.picker.length > 0) {
            finalUrl = data.picker[0].url;
            title = data.picker[0].filename || title;
        } else if (data.status === 'local-processing') {
            finalUrl = data.tunnel?.[0] || data.audio?.url;
        }

        if (finalUrl) {
            return res.json({
                success: true,
                title: title,
                thumbnail: data.thumbnail || '',
                downloadUrl: finalUrl
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
        const searchResult = yts(query);
        const video = (await searchResult).videos[0];
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
