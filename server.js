const express = require('express');
const cors = require('cors');
const youtubedl = require('youtube-dl-exec');
const yts = require('yt-search');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

// Universal Downloader Endpoint
app.post('/download', async (req, res) => {
    const { url, type } = req.body; // type: 'video' or 'audio'
    if (!url) return res.status(400).json({ error: 'URL is required' });

    try {
        const flags = {
            dumpSingleJson: true,
            noCheckCertificates: true,
            noWarnings: true,
            preferFreeFormats: true,
            addHeader: ['referer:https://www.google.com'],
        };

        if (type === 'audio') {
            flags.extractAudio = true;
            flags.audioFormat = 'mp3';
        }

        const output = await youtubedl(url, flags);
        let mediaUrl = '';

        if (type === 'audio') {
            const audioFormat = output.formats.reverse().find(f => f.acodec !== 'none' && f.vcodec === 'none');
            mediaUrl = audioFormat ? audioFormat.url : output.url;
        } else {
            const videoFormat = output.formats.reverse().find(f => f.vcodec !== 'none' && f.acodec !== 'none' && f.ext === 'mp4');
            mediaUrl = videoFormat ? videoFormat.url : output.url;
        }

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

// YouTube Search Endpoint for .play and .video text lookups
app.get('/search', async (req, res) => {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'Query is required' });

    try {
        const searchResult = await yts(query);
        const video = searchResult.videos[0];
        if (!video) return res.status(404).json({ error: 'No results found' });

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
