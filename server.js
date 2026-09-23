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
        // Using a reliable public media proxy API endpoint
        const response = await fetch(`https://api.vkrpn.workers.dev/api/dl?url=${encodeURIComponent(url)}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const data = await response.json();

        if (data && (data.url || data.downloadUrl || data.link)) {
            return res.json({
                success: true,
                title: data.title || 'KINGBOT Media',
                thumbnail: data.thumbnail || '',
                downloadUrl: data.url || data.downloadUrl || data.link
            });
        }

        // Fallback secondary route if primary stream is empty
        const altResponse = await fetch(`https://delivrio.xyz/api/download?url=${encodeURIComponent(url)}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const altData = await altResponse.json();

        if (altData && altData.success) {
            return res.json({
                success: true,
                title: altData.title || 'KINGBOT Media',
                thumbnail: altData.thumbnail || '',
                downloadUrl: altData.downloadUrl
            });
        }

        return res.status(200).json({ 
            success: false, 
            error: 'Stream currently unavailable. Please try another link.' 
        });

    } catch (err) {
        console.error('Download Error:', err);
        return res.status(200).json({ 
            success: false, 
            error: 'Server connection error'
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
