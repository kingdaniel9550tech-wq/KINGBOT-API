const express = require('express');
const cors = require('cors');
const yts = require('yt-search');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

// Helper to extract YouTube ID
function extractYouTubeId(url) {
    const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    return match ? match[1] : null;
}

// Universal Downloader Endpoint
app.post('/download', async (req, res) => {
    const { url, type } = req.body; 
    if (!url) {
        return res.status(200).json({ success: false, error: 'URL is required' });
    }

    let downloadUrl = null;
    let title = 'KINGBOT Media';
    let thumbnail = '';

    const videoId = extractYouTubeId(url);

    // Gateway: Direct JSON Audio/Video Stream Extractor Mirror
    if (videoId) {
        try {
            const format = type === 'audio' ? 'mp3' : 'videos';
            const apiRes = await fetch(`https://api.download-lagu-mp3.com/@api/json/${format}/${videoId}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
                }
            });
            const text = await apiRes.text();
            
            // Safely verify response is valid JSON before parsing
            if (text.startsWith('{')) {
                const data = JSON.parse(text);
                if (data.status === 'success' || data.link || data.dl_url) {
                    downloadUrl = data.link || data.dl_url;
                    title = data.title || title;
                    thumbnail = data.thumbnail || '';
                }
            }
        } catch (err) {
            console.error('Download Mirror Error:', err.message);
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
            error: 'Failed to extract direct media stream from mirrors.' 
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
