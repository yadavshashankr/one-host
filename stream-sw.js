// Stream Service Worker
// Lets a received video or audio file play while it arrives, and lets a received file download
// straight to disk. The preview's player loads ./__preview-stream/<id>/<name>?size=<bytes>&type=<mime>;
// this worker answers those requests with the byte ranges the player asks for, fetching each
// piece from the page, which asks the sender over the peer connection (js/services/filePreview.js,
// script.js). With &download=1 the same stream is answered as a file download, so the browser's
// download manager writes each piece to disk as it arrives instead of the page holding the file.
//
// It handles nothing else: every other request goes to the network exactly as without it.
// It keeps no state between requests (browsers stop idle workers, iOS quickly), so everything
// it needs is in the address, and the page that owns the stream is found by asking each window.

const STREAM_PATH = '/__preview-stream/';
const STREAM_CHUNK = 512 * 1024;     // Bytes per piece asked of the page
const STREAM_AHEAD = 3;              // Pieces asked for in advance, so playback doesn't wait on each
const STREAM_PIECE_TIMEOUT = 20000;

self.addEventListener('install', () => self.skipWaiting());
// Take over open pages straight away, so streaming works on the first visit without a reload
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;
    const at = url.pathname.indexOf(STREAM_PATH);
    if (at === -1) return; // Not a stream: the browser handles it as usual
    const streamId = url.pathname.slice(at + STREAM_PATH.length).split('/')[0];
    event.respondWith(streamResponse(event.request, streamId, url.searchParams));
});

// One piece of the file from whichever page owns the stream (the others answer ok: false)
async function askPage(streamId, start, end) {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (!windows.length) throw new Error('No page');
    return new Promise((resolve, reject) => {
        let waiting = windows.length;
        const timer = setTimeout(() => reject(new Error('Timed out')), STREAM_PIECE_TIMEOUT);
        windows.forEach((client) => {
            const channel = new MessageChannel();
            channel.port1.onmessage = (event) => {
                const reply = event.data || {};
                if (reply.ok) {
                    clearTimeout(timer);
                    resolve(reply);
                } else if (--waiting === 0) {
                    clearTimeout(timer);
                    reject(new Error(reply.error || 'Stream not found'));
                }
            };
            client.postMessage({ type: 'preview-stream-range', streamId, start, end }, [channel.port2]);
        });
    });
}

async function streamResponse(request, streamId, params) {
    const size = Number(params.get('size'));
    const type = params.get('type') || 'application/octet-stream';
    if (!streamId || !Number.isFinite(size) || size <= 0) return new Response(null, { status: 400 });

    // "bytes=start-end", "bytes=start-" or "bytes=-suffix"; no Range header means the whole file
    const rangeHeader = request.headers.get('Range');
    const match = rangeHeader && /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    let start = 0;
    let end = size - 1;
    if (match) {
        if (match[1]) {
            start = Number(match[1]);
            if (match[2]) end = Math.min(Number(match[2]), size - 1);
        } else if (match[2]) {
            start = Math.max(0, size - Number(match[2]));
        }
    }
    if (start > end || start >= size) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }

    let next = start;
    const inflight = [];
    const fill = () => {
        while (inflight.length < STREAM_AHEAD && next <= end) {
            const pieceEnd = Math.min(end, next + STREAM_CHUNK - 1);
            const piece = askPage(streamId, next, pieceEnd);
            piece.catch(() => {}); // Pieces dropped after a cancel shouldn't report errors
            inflight.push(piece);
            next = pieceEnd + 1;
        }
    };

    // Wait for the first piece, so a stream that can't be served fails with an error status
    fill();
    try {
        await inflight[0];
    } catch (error) {
        return new Response(null, { status: 502, statusText: error.message });
    }

    const body = new ReadableStream({
        async pull(controller) {
            if (!inflight.length) {
                controller.close();
                return;
            }
            try {
                const reply = await inflight.shift();
                controller.enqueue(new Uint8Array(reply.data));
                fill();
                if (!inflight.length) controller.close();
            } catch (error) {
                controller.error(error);
            }
        },
        cancel() {
            // The player moved elsewhere (a seek) or closed: stop asking for this range
            inflight.length = 0;
            next = end + 1;
        }
    });

    const headers = {
        'Content-Type': type,
        'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store'
    };
    if (params.get('download') === '1') {
        const name = params.get('name') || 'download';
        const plain = name.replace(/[^\x20-\x7e]|["\\]/g, '_'); // For browsers that ignore filename*
        headers['Content-Disposition'] = `attachment; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(name)}`;
    }
    if (match) {
        headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
        return new Response(body, { status: 206, headers });
    }
    return new Response(body, { status: 200, headers });
}
