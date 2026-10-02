const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const yts = require('yt-search');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

// Serve downloaded media files statically from /tmp
app.use('/media', express.static('/tmp'));

if (!fs.existsSync('/tmp')) {
    fs.mkdirSync('/tmp', { recursive: true });
}

// Ensure yt-dlp binary exists in /tmp for cloud environments (Railway, Render, etc.)
const ytdlpPath = path.join('/tmp', 'yt-dlp');

async function ensureYtDlp() {
    if (!fs.existsSync(ytdlpPath)) {
        console.log('Downloading yt-dlp binary for cloud environment...');
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(ytdlpPath);
            https.get('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp', (response) => {
                if (response.statusCode === 302 || response.statusCode === 301) {
                    https.get(response.headers.location, (redirectRes) => {
                        redirectRes.pipe(file);
                        file.on('finish', () => {
                            file.close();
                            fs.chmodSync(ytdlpPath, '755');
                            console.log('yt-dlp downloaded and ready successfully.');
                            resolve();
                        });
                    }).on('error', reject);
                } else {
                    response.pipe(file);
                    file.on('finish', () => {
                        file.close();
                        fs.chmodSync(ytdlpPath, '755');
                        console.log('yt-dlp downloaded and ready successfully.');
                        resolve();
                    });
                }
            }).on('error', (err) => {
                console.error('Failed to download yt-dlp:', err.message);
                reject(err);
            });
        });
    }
}

// Initialize yt-dlp on startup
ensureYtDlp().catch(console.error);

// Multi-Platform Downloader Endpoint (YouTube, TikTok, Facebook, Instagram, Audiomack, etc.)
app.post('/download', async (req, res) => {
    const { url, type } = req.body; 
    if (!url) return res.status(400).json({ success: false, error: 'URL is required' });

    // Ensure yt-dlp is ready before processing
    await ensureYtDlp().catch(() => {});
    const activeYtDlp = fs.existsSync(ytdlpPath) ? ytdlpPath : 'yt-dlp';

    const fileId = Date.now();
    const outputTemplate = `/tmp/${fileId}_%(id)s.%(ext)s`;

    let success = false;
    let videoTitle = 'KINGBOT Media';
    let videoThumbnail = '';
    let downloadedFile = null;
    let lastError = null;

    const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');

    if (isYouTube) {
        // 1. YouTube Client Rotation Logic to bypass bot blocks
        const clients = ['android', 'mweb', 'web'];
        for (const client of clients) {
            try {
                // Safely attempt metadata fetch without crashing if it fails
                try {
                    const metaCmd = `${activeYtDlp} --dump-json --no-check-certificates --extractor-args "youtube:player_client=${client}" "${url}"`;
                    const { stdout: metaStdout } = await execPromise(metaCmd, { maxBuffer: 1024 * 1024 * 10 });
                    if (metaStdout && metaStdout.trim().startsWith('{')) {
                        const meta = JSON.parse(metaStdout);
                        videoTitle = meta.title || videoTitle;
                        videoThumbnail = meta.thumbnail || videoThumbnail;
                    }
                } catch (metaErr) {
                    // Non-fatal: proceed with download even if metadata dump fails
                }

                let dlCmd = '';
                if (type === 'audio') {
                    dlCmd = `${activeYtDlp} -x --audio-format mp3 --extractor-args "youtube:player_client=${client}" -o "${outputTemplate}" --no-check-certificates "${url}"`;
                } else {
                    dlCmd = `${activeYtDlp} -f "best[ext=mp4]/best" --extractor-args "youtube:player_client=${client}" -o "${outputTemplate}" --no-check-certificates "${url}"`;
                }

                try {
                    await execPromise(dlCmd, { maxBuffer: 1024 * 1024 * 50 });
                } catch (audioErr) {
                    if (type === 'audio') {
                        const fallbackAudioCmd = `${activeYtDlp} -f "bestaudio" --extractor-args "youtube:player_client=${client}" -o "${outputTemplate}" --no-check-certificates "${url}"`;
                        await execPromise(fallbackAudioCmd, { maxBuffer: 1024 * 1024 * 50 });
                    } else {
                        throw audioErr;
                    }
                }

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
        // 2. Multi-Platform Logic for TikTok, Facebook, Instagram, Audiomack, etc.
        try {
            try {
                const metaCmd = `${activeYtDlp} --dump-json --no-check-certificates "${url}"`;
                const { stdout: metaStdout } = await execPromise(metaCmd, { maxBuffer: 1024 * 1024 * 10 });
                if (metaStdout && metaStdout.trim().startsWith('{')) {
                    const meta = JSON.parse(metaStdout);
                    videoTitle = meta.title || meta.description || videoTitle;
                    videoThumbnail = meta.thumbnail || videoThumbnail;
                }
            } catch (metaErr) {
                // Non-fatal
            }

            let dlCmd = '';
            if (type === 'audio') {
                dlCmd = `${activeYtDlp} -x --audio-format mp3 -o "${outputTemplate}" --no-check-certificates "${url}"`;
            } else {
                dlCmd = `${activeYtDlp} -f "best[ext=mp4]/best/best" -o "${outputTemplate}" --no-check-certificates "${url}"`;
            }

            try {
                await execPromise(dlCmd, { maxBuffer: 1024 * 1024 * 50 });
            } catch (audioErr) {
                if (type === 'audio') {
                    const fallbackAudioCmd = `${activeYtDlp} -f "bestaudio" -o "${outputTemplate}" --no-check-certificates "${url}"`;
                    await execPromise(fallbackAudioCmd, { maxBuffer: 1024 * 1024 * 50 });
                } else {
                    throw audioErr;
                }
            }

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
        console.error("Downloader Error:", lastError);
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
