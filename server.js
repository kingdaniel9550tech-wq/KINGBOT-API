const express = require('express');
const cors = require('cors');
const yts = require('yt-search');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

// Universal Downloader with Multi-Gateway Fallback (Permanent Fix)
app.post('/download', async (req, res) => {
    const { url, type } = req.body; 
    if (!url) {
        return res.status(200).json({ success: false, error: 'URL is required' });
    }

    let downloadUrl = null;
    let title = 'KINGBOT Media';
    let thumbnail = '';

    // Gateway 1: Cobalt API
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
        if (data.status === 'redirect' || data.status === 'tunnel' || data.url) {
            downloadUrl = data.url;
            title = data.filename || title;
            thumbnail = data.thumbnail || '';
        } else if (data.status === 'picker' && data.picker?.[0]?.url) {
            downloadUrl = data.picker[0].url;
            title = data.picker[0].filename || title;
            thumbnail = data.thumbnail || '';
        }
    } catch (err) {
        console.log('Gateway 1 skipped, rolling over...');
    }

    // Gateway 2: Secondary Public Media Extractor (Instant Fallback)
    if (!downloadUrl) {
        try {
            const altResponse = await fetch(`https://delivrio.xyz/api/download?url=${encodeURIComponent(url)}`, {
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            const altData = await altResponse.json();
            if (altData.success && altData.downloadUrl) {
                downloadUrl = altData.downloadUrl;
                title = altData.title || title;
                thumbnail = altData.thumbnail || thumbnail;
            }
        } catch (err) {
            console.log('Gateway 2 skipped...');
        }
    }

    if (downloadUrl) {
        return res.json({
            success: true,
            title: title,
            thumbnail: thumbnail,
            downloadUrl: downloadUrl
        });
    } else {
        return res.status(200).json({ 
            success: false, 
            error: 'Stream extraction failed across all redundant gateways.' 
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
