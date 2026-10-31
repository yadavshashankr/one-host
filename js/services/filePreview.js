// File Preview Service
// Read-only preview of sent and received files in an overlay on the same page,
// so peer connections and transfers are never interrupted (no new tab, no navigation).
//
// Received files are never transferred to preview them. The receiver asks the sender for a
// preview and the sender builds a small one from its own copy (createPreview): a reduced image,
// a slice of text, PDF pages, sheet rows, a document's text, slides, or an archive's file list.
// The sender builds it for each request and keeps nothing once it's sent; asking again builds it
// again. If the sender can't (older version, file too big, unreadable), the overlay shows
// "Preview unavailable". Received videos and audio stream instead: the player asks stream-sw.js
// for byte ranges, and each range is fetched from the sender as it's needed. Where streaming
// can't work, they show "Preview unavailable" and nothing is transferred. Closing the overlay
// releases everything the preview held.
//
// Images and documents zoom by pinch, Ctrl/Cmd + scroll, the +/- keys or the on-screen
// controls. Video and audio use the browser's own player.

const PREVIEW_EXTENSIONS = {
    image: ['jpg', 'jpeg', 'jfif', 'pjpeg', 'png', 'apng', 'gif', 'webp', 'avif', 'bmp', 'ico', 'cur', 'svg',
        'heic', 'heif', 'tif', 'tiff', 'psd'],
    video: ['mp4', 'm4v', 'webm', 'mov', 'ogv'],
    audio: ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac'],
    text: ['txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'json', 'xml', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf',
        'env', 'html', 'htm', 'css', 'scss', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'rb', 'php', 'java', 'kt',
        'swift', 'go', 'rs', 'c', 'h', 'cpp', 'hpp', 'cs', 'sh', 'bash', 'zsh', 'bat', 'ps1', 'sql', 'srt', 'vtt',
        'eml', 'ics', 'vcf', 'tex', 'rst', 'adoc', 'org', 'properties', 'gradle', 'lua', 'pl', 'r', 'scala', 'dart',
        'vue', 'svelte', 'xaml', 'plist', 'nfo', 'diz', 'asc', 'reg', 'inf', 'm3u', 'pls', 'cue', 'gpx', 'kml'],
    // Zip-based packages (Java, Android, iOS, browser extensions, Python, .NET) list like a zip
    archive: ['zip', 'jar', 'war', 'ear', 'apk', 'aab', 'ipa', 'xpi', 'whl', 'nupkg', 'vsix', 'tar', 'tgz'],
    pdf: ['pdf', 'ai'], // Illustrator files are usually saved with a PDF inside
    sheet: ['xlsx', 'xlsm', 'xlsb', 'xltx', 'xltm', 'xls', 'xlt', 'xlw', 'ods', 'ots', 'fods', 'numbers',
        'dbf', 'wk1', 'wk2', 'wk3', 'wk4', '123', 'wq1', 'wq2', 'wb1', 'wb2', 'wb3', 'qpw', 'slk', 'sylk', 'dif'],
    document: ['docx', 'docm', 'dotx', 'dotm', 'doc', 'dot', 'rtf', 'odt', 'ott', 'epub', 'msg', 'pages'],
    slides: ['pptx', 'pptm', 'ppsx', 'ppsm', 'potx', 'potm', 'ppt', 'pps', 'pot', 'odp', 'otp', 'key']
};

// MIME types for files sent without one; images, video and audio need a real type to render
const PREVIEW_MIME_TYPES = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml', heic: 'image/heic',
    jfif: 'image/jpeg', pjpeg: 'image/jpeg', apng: 'image/apng', cur: 'image/x-icon', tif: 'image/tiff',
    tiff: 'image/tiff', psd: 'image/vnd.adobe.photoshop',
    heif: 'image/heif', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    ogv: 'video/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav',
    ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac'
};

const PREVIEW_IMAGE_MAX_SIDE = 2048;              // Long side of a reduced image
const PREVIEW_IMAGE_SEND_ORIGINAL = 1.5 * 1024 * 1024; // Smaller images are sent as they are
const PREVIEW_GIF_SEND_ORIGINAL = 8 * 1024 * 1024;     // GIFs keep their animation up to this size
const PREVIEW_TEXT_PART = 256 * 1024;             // Bytes of text per part ("Load more" fetches the next)
const PREVIEW_ZIP_MAX_ENTRIES = 5000;
const PREVIEW_PDF_PAGE_WIDTH = 1600;              // Pixel width a PDF page is drawn at
const PREVIEW_PDF_IDLE_CLOSE = 10000;             // Sender closes a PDF this long after its last page request
const PREVIEW_SHEET_MAX_SHEETS = 30;
const PREVIEW_SHEET_MAX_ROWS = 1000;              // Per sheet
const PREVIEW_SHEET_MAX_COLS = 100;
const PREVIEW_SHEET_MAX_CHARS = 2 * 1024 * 1024;  // All cells together, so the message stays small
const PREVIEW_DOCX_MAX_HTML = 4 * 1024 * 1024;
const PREVIEW_DOC_IMAGE_BUDGET = 3 * 1024 * 1024; // Pictures inside a docx or pptx preview, together
const PREVIEW_PPTX_MAX_SLIDES = 200;
const PREVIEW_PPTX_IMAGE_SIDE = 640;
// Largest file the sender will open to build a preview (a phone sender has less memory)
const PREVIEW_SENDER_MAX_BYTES = {
    image: { mobile: 100 * 1024 * 1024, desktop: 300 * 1024 * 1024 },
    archive: { mobile: 300 * 1024 * 1024, desktop: 1024 * 1024 * 1024 },
    pdf: { mobile: 200 * 1024 * 1024, desktop: 1024 * 1024 * 1024 },
    sheet: { mobile: 50 * 1024 * 1024, desktop: 150 * 1024 * 1024 },
    document: { mobile: 50 * 1024 * 1024, desktop: 200 * 1024 * 1024 },
    slides: { mobile: 200 * 1024 * 1024, desktop: 500 * 1024 * 1024 }
};
const PREVIEW_PSD_MAX_PIXELS = { mobile: 16e6, desktop: 50e6 }; // Larger ones show their thumbnail

// Readers for documents, loaded on the sender only the first time one is needed.
// Each file is checked against its hash before it runs.
const PDFJS_BASE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/';
const PREVIEW_LIBRARIES = {
    pdf: { url: PDFJS_BASE + 'legacy/build/pdf.min.mjs',
        integrity: 'sha384-z/XbAtvhBXJoK+yvYimnFuTCF6/2wTCDSIFD09/HtIfwFtvDKOMdAe5Z3wOChkmW' },
    pdfWorker: { url: PDFJS_BASE + 'legacy/build/pdf.worker.min.mjs',
        integrity: 'sha384-vbNBYP03jHFPlgtK4qSXtazEmGfmpTWlSsfq9OiU20MroW/Q9TbaEXiM7PpeWg+6' },
    xlsx: { url: 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
        integrity: 'sha384-EnyY0/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP+39Ckmn92stwABZynq1JyzdT', global: 'XLSX' },
    mammoth: { url: 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js',
        integrity: 'sha384-/cXAMbzovUIKbBERjPmR3SnPTh8siWr5lsvFYj1Uq4XP0yaJUZJmsh0YXyGv5P0y', global: 'mammoth' },
    utif: { url: 'https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js',
        integrity: 'sha384-RyBmXHdfZ/Uon+ud+/AqSyWpUWnKYt2tkRG/P4gWoRUGDU+qIAV3tGBPNlYTBZEF', global: 'UTIF' }
};

// A file's preview may come back as a different kind: Pages, Keynote and Numbers files, for
// example, carry a picture of their first page that is shown when nothing better is available
const PREVIEW_ACCEPTED_KINDS = {
    document: ['document', 'image'],
    slides: ['slides', 'image'],
    sheet: ['sheet', 'image']
};

const ZOOM_LIMITS = {
    image: { min: 0.5, max: 8 },
    pdf: { min: 0.5, max: 5 },
    text: { min: 0.5, max: 4 },
    archive: { min: 0.5, max: 4 },
    sheet: { min: 0.5, max: 4 },
    document: { min: 0.5, max: 4 },
    slides: { min: 0.5, max: 4 }
};
const ZOOM_STEP = 1.25;

// Tags kept from a Word document's HTML; everything else is dropped or unwrapped
const DOCX_ALLOWED_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'STRONG', 'B', 'EM', 'I', 'U', 'S',
    'SUB', 'SUP', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'BR', 'IMG', 'BLOCKQUOTE',
    'PRE', 'CODE', 'HR', 'SPAN']);
const DOCX_DROPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'TEMPLATE',
    'NOSCRIPT', 'LINK', 'META', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'VIDEO', 'AUDIO', 'SOURCE']);
const SAFE_IMAGE_TYPES = /^image\/(png|jpeg|gif|webp)$/;

// An error whose message is meant for the person looking at the preview
class PreviewUnavailableError extends Error {}

class FilePreview {
    constructor() {
        this.overlay = null;
        this.session = null; // State of the preview that is open, null when closed
        // Sender side: previews are built for each request and not kept once sent. Only a PDF stays
        // open while its pages are being asked for (see openPdf).
        this.openPdfs = new Map(); // blob -> { promise, timer, active }
        this.libraries = {}; // name -> Promise of the loaded library
        this.onPopState = this.onPopState.bind(this);
        this.onKeyDown = this.onKeyDown.bind(this);
        // streamId -> requestRange(start, end), answered for stream-sw.js: preview players and
        // downloads that go straight to disk (startStreamDownload in script.js)
        this.streams = new Map();
        this.streamWorkerReady = this.registerStreamWorker();
    }

    // ---- Streaming (received video and audio) ----

    registerStreamWorker() {
        if (!('serviceWorker' in navigator) || !window.isSecureContext) return Promise.resolve(false);
        navigator.serviceWorker.addEventListener('message', (event) => this.onStreamMessage(event));
        if (navigator.serviceWorker.startMessages) navigator.serviceWorker.startMessages();
        return navigator.serviceWorker.register('stream-sw.js').then(() => true).catch(error => {
            // Some in-app browsers and private windows don't allow it; streaming is then unavailable
            console.warn('Stream worker not registered:', error);
            return false;
        });
    }

    // Resolves true once the stream worker controls this page (it takes over a new page by itself)
    async ensureStreamWorker() {
        if (!(await this.streamWorkerReady)) return false;
        if (navigator.serviceWorker.controller) return true;
        return new Promise(resolve => {
            const timer = setTimeout(() => resolve(!!navigator.serviceWorker.controller), 4000);
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                clearTimeout(timer);
                resolve(true);
            }, { once: true });
        });
    }

    // The worker asks every open page for a piece; only the page that owns the stream fetches it
    onStreamMessage(event) {
        const data = event.data || {};
        const port = event.ports && event.ports[0];
        if (data.type !== 'preview-stream-range' || !port) return;
        const requestRange = this.streams.get(data.streamId);
        if (!requestRange) {
            port.postMessage({ ok: false, error: 'Unknown stream' });
            return;
        }
        requestRange(Number(data.start), Number(data.end)).then(piece => {
            if (!this.streams.has(data.streamId)) throw new Error('Stream closed');
            port.postMessage({ ok: true, data: piece.data, total: piece.total }, [piece.data]);
        }).catch(error => {
            port.postMessage({ ok: false, error: error.message });
        });
    }

    async streamMedia(tag, requestRange) {
        const session = this.session;
        const { fileInfo } = session;
        let mime = this.getMimeType(fileInfo.name, fileInfo.type);
        // Formats this browser says it can't play are never transferred. QuickTime files are
        // usually MP4 inside, so they're offered to the player as MP4 and tried.
        if (/quicktime/.test(mime)) mime = 'video/mp4';
        if (!document.createElement(tag).canPlayType(mime)) {
            this.showUnavailable(`This browser can't play this ${tag} format.`);
            return;
        }
        this.showLoading();
        const ready = await this.ensureStreamWorker();
        if (this.session !== session) return;
        if (!ready) {
            this.showUnavailable(`This browser can't stream the ${tag}. Opening One-Host in Safari or Chrome may work.`);
            return;
        }
        const streamId = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
        this.streams.set(streamId, requestRange);
        session.streamId = streamId;
        const src = `__preview-stream/${streamId}/${encodeURIComponent(fileInfo.name)}` +
            `?size=${fileInfo.size}&type=${encodeURIComponent(mime)}`;
        this.renderMediaSource(src, tag, true);
    }

    // 'image', 'video', 'audio', 'text', 'archive', 'pdf', 'sheet', 'document', 'slides',
    // or null when the type can't be previewed
    getPreviewKind(name, mimeType = '') {
        const ext = this.getExtension(name);
        const type = (mimeType || '').toLowerCase();
        if (/\.tar\.gz$/i.test(name || '')) return 'archive';
        for (const [kind, extensions] of Object.entries(PREVIEW_EXTENSIONS)) {
            if (extensions.includes(ext)) return kind;
        }
        if (type.startsWith('image/')) return 'image';
        if (type.startsWith('video/')) return 'video';
        if (type.startsWith('audio/')) return 'audio';
        if (type === 'application/pdf') return 'pdf';
        if (/spreadsheetml|ms-excel|opendocument\.spreadsheet/.test(type)) return 'sheet';
        if (/wordprocessingml|msword|rtf|opendocument\.text|epub/.test(type)) return 'document';
        if (/presentationml|ms-powerpoint|opendocument\.presentation/.test(type)) return 'slides';
        if (/zip|x-tar|java-archive/.test(type)) return 'archive';
        if (type.startsWith('text/') || /json|xml|javascript|yaml/.test(type)) return 'text';
        return null;
    }

    canPreview(name, mimeType) {
        return this.getPreviewKind(name, mimeType) !== null;
    }

    getExtension(name) {
        const dot = (name || '').lastIndexOf('.');
        return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
    }

    getMimeType(name, mimeType) {
        if (mimeType && mimeType !== 'application/octet-stream') return mimeType;
        return PREVIEW_MIME_TYPES[this.getExtension(name)] || mimeType || '';
    }

    isMobile() {
        return /mobile|android|iphone|ipad|tablet/i.test(navigator.userAgent);
    }

    // ---- Building previews (runs on the device that has the file) ----

    /**
     * Small, read-only preview of a file this device has.
     * image: { kind, data, mime, reduced }   text: { kind, data, offset, nextOffset, size }
     * zip:   { kind, entries: [{ name, size }], count, total }
     * pdf:   { kind, page, pageCount, data, mime, width, height }  (one page per request)
     * sheet: { kind, sheets: [{ name, rows, totalRows, totalCols }], sheetCount }
     * docx:  { kind, html }   (cleaned again by the receiver before it is shown)
     * pptx:  { kind, thumbnail, slides: [{ title, texts, image }], slideCount }
     * data is an ArrayBuffer so it can be sent to a peer (a Blob when local is true).
     * @param {object} part - { offset } for the next slice of a text file, { page } for a PDF page
     * @param {boolean} local - Preview on this same device: images are shown at full quality
     */
    async createPreview(blob, name, mimeType, { offset = 0, page = 1, local = false } = {}) {
        const kind = this.getPreviewKind(name, mimeType);
        const device = this.isMobile() ? 'mobile' : 'desktop';
        const limit = PREVIEW_SENDER_MAX_BYTES[kind]?.[device];
        const checkSize = () => {
            if (limit && blob.size > limit) throw new PreviewUnavailableError('This file is too large to preview.');
        };
        if (kind === 'text') {
            const start = Math.max(0, Math.min(blob.size, Number(offset) || 0));
            const end = Math.min(blob.size, start + PREVIEW_TEXT_PART);
            const slice = blob.slice(start, end);
            return { kind, data: local ? slice : await slice.arrayBuffer(), offset: start, nextOffset: end, size: blob.size };
        }
        if (kind === 'image') {
            const mime = this.getMimeType(name, mimeType || blob.type);
            // HEIC, TIFF and Photoshop files only display in some browsers (or none), so they're converted
            const convert = /heic|heif|tiff|photoshop/.test(mime);
            if (local && !convert) return { kind, data: blob, mime, reduced: false };
            const keepOriginal = !convert && (blob.size <= PREVIEW_IMAGE_SEND_ORIGINAL ||
                (mime === 'image/gif' && blob.size <= PREVIEW_GIF_SEND_ORIGINAL));
            if (keepOriginal) return { kind, data: await blob.arrayBuffer(), mime, reduced: false };
            checkSize();
            return this.convertImage(blob, mime);
        }
        checkSize();
        const ext = this.getExtension(name);
        if (kind === 'pdf') return this.renderPdfPage(blob, page, local);
        if (kind === 'archive') {
            if (ext === 'tar' || ext === 'tgz' || /\.tar\.gz$/i.test(name)) {
                return this.listTar(blob, ext !== 'tar');
            }
            return this.listZip(blob);
        }
        if (kind === 'sheet') {
            return this.readSheets(blob).catch(error => {
                if (ext === 'numbers') return this.readIworkPreview(blob); // Picture of the first sheet
                throw error;
            });
        }
        if (kind === 'document') return this.readDocument(blob, ext);
        if (kind === 'slides') return this.readSlides(blob, ext);
        throw new PreviewUnavailableError('This file type can\'t be previewed.');
    }

    // Draws an image smaller (maxSide on its long side) and encodes it. WebP where the browser can
    // encode it; otherwise PNG for formats that can be transparent and JPEG for the rest.
    async reduceImage(blob, mime, maxSide = PREVIEW_IMAGE_MAX_SIDE) {
        const url = URL.createObjectURL(mime && blob.type !== mime ? new Blob([blob], { type: mime }) : blob);
        try {
            const img = await new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve(image);
                image.onerror = () => reject(new PreviewUnavailableError('This image format can\'t be previewed.'));
                image.src = url;
            });
            const width = img.naturalWidth || maxSide;
            const height = img.naturalHeight || maxSide;
            const scale = Math.min(1, maxSide / Math.max(width, height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(width * scale));
            canvas.height = Math.max(1, Math.round(height * scale));
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            const out = await this.encodeCanvas(canvas, /png|gif|webp|svg|avif|ico|bmp/.test(mime));
            return { kind: 'image', data: await out.arrayBuffer(), mime: out.type, reduced: true };
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    async encodeCanvas(canvas, transparent) {
        const encode = (type, quality) => new Promise(resolve => canvas.toBlob(resolve, type, quality));
        let out = await encode('image/webp', 0.82);
        if (!out || out.type !== 'image/webp') out = await encode(transparent ? 'image/png' : 'image/jpeg', 0.82);
        canvas.width = canvas.height = 0; // Free the drawing's pixels now rather than at the next clean-up
        if (!out) throw new PreviewUnavailableError('This file couldn\'t be previewed.');
        return out;
    }

    async listZip(blob) {
        if (typeof JSZip === 'undefined') throw new PreviewUnavailableError('Zip preview isn\'t available.');
        let zip;
        try {
            zip = await JSZip.loadAsync(blob);
        } catch (error) {
            throw new PreviewUnavailableError('This zip couldn\'t be read.');
        }
        const files = Object.values(zip.files)
            .filter(entry => !entry.dir && !entry.name.startsWith('__MACOSX/'))
            .sort((a, b) => a.name.localeCompare(b.name));
        const sizeOf = entry => entry._data?.uncompressedSize || 0;
        return {
            kind: 'archive',
            entries: files.slice(0, PREVIEW_ZIP_MAX_ENTRIES).map(entry => ({ name: entry.name, size: sizeOf(entry) })),
            count: files.length,
            total: files.reduce((sum, entry) => sum + sizeOf(entry), 0)
        };
    }

    // ---- Document readers (sender side) ----

    // Fetches a library file and checks it against its hash before use (like a script's integrity)
    async fetchVerified(library) {
        const response = await fetch(library.url, { mode: 'cors', credentials: 'omit' });
        if (!response.ok) throw new Error(`Couldn't load ${library.url}`);
        const bytes = await response.arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-384', bytes);
        const hash = 'sha384-' + btoa(String.fromCharCode(...new Uint8Array(digest)));
        if (hash !== library.integrity) throw new Error(`Integrity check failed for ${library.url}`);
        return URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
    }

    loadLibrary(name) {
        if (!this.libraries[name]) {
            const library = PREVIEW_LIBRARIES[name];
            this.libraries[name] = new Promise((resolve, reject) => {
                if (window[library.global]) return resolve(window[library.global]);
                const script = document.createElement('script');
                script.src = library.url;
                script.integrity = library.integrity;
                script.crossOrigin = 'anonymous';
                script.onload = () => window[library.global] ? resolve(window[library.global]) : reject(new Error(`${name} missing`));
                script.onerror = () => reject(new Error(`Couldn't load ${name}`));
                document.head.appendChild(script);
            });
            this.libraries[name].catch(() => delete this.libraries[name]); // Retry next time
        }
        return this.libraries[name].catch(error => {
            console.warn('Preview library failed to load:', error);
            throw new PreviewUnavailableError('The sender couldn\'t load the document reader.');
        });
    }

    loadPdfJs() {
        if (!this.libraries.pdf) {
            this.libraries.pdf = (async () => {
                const [moduleUrl, workerUrl] = await Promise.all([
                    this.fetchVerified(PREVIEW_LIBRARIES.pdf),
                    this.fetchVerified(PREVIEW_LIBRARIES.pdfWorker)
                ]);
                const pdfjs = await import(moduleUrl);
                pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
                return pdfjs;
            })();
            this.libraries.pdf.catch(() => delete this.libraries.pdf);
        }
        return this.libraries.pdf.catch(error => {
            console.warn('PDF reader failed to load:', error);
            throw new PreviewUnavailableError('The sender couldn\'t load the PDF reader.');
        });
    }

    // PDF pages are asked for one by one as the viewer scrolls, and opening a PDF copies the whole
    // file into the PDF reader, so it stays open while pages keep coming and closes
    // PREVIEW_PDF_IDLE_CLOSE after the last one. Use with releasePdf.
    openPdf(blob) {
        let entry = this.openPdfs.get(blob);
        if (!entry) {
            const promise = (async () => {
                const pdfjs = await this.loadPdfJs();
                try {
                    return await pdfjs.getDocument({
                        data: new Uint8Array(await blob.arrayBuffer()),
                        isEvalSupported: false, // Fonts are never compiled into code
                        enableXfa: false,
                        cMapUrl: PDFJS_BASE + 'cmaps/',
                        cMapPacked: true,
                        standardFontDataUrl: PDFJS_BASE + 'standard_fonts/'
                    }).promise;
                } catch (error) {
                    if (error && error.name === 'PasswordException') {
                        throw new PreviewUnavailableError('This PDF is password protected.');
                    }
                    throw new PreviewUnavailableError('This PDF couldn\'t be read.');
                }
            })();
            entry = { promise, timer: null, active: 0 };
            this.openPdfs.set(blob, entry);
            promise.catch(() => this.openPdfs.get(blob) === entry && this.openPdfs.delete(blob));
        }
        clearTimeout(entry.timer);
        entry.active++;
        return entry;
    }

    releasePdf(blob, entry) {
        entry.active--;
        if (entry.active > 0) return;
        entry.timer = setTimeout(async () => {
            if (this.openPdfs.get(blob) !== entry || entry.active > 0) return;
            this.openPdfs.delete(blob);
            try {
                await (await entry.promise).destroy(); // Frees the reader's copy of the file
            } catch (error) {
                // Never opened; nothing to free
            }
        }, PREVIEW_PDF_IDLE_CLOSE);
    }

    async renderPdfPage(blob, pageNumber, local) {
        const entry = this.openPdf(blob);
        try {
            const pdf = await entry.promise;
            return await this.drawPdfPage(pdf, pageNumber, local);
        } finally {
            this.releasePdf(blob, entry);
        }
    }

    async drawPdfPage(pdf, pageNumber, local) {
        const number = Math.min(pdf.numPages, Math.max(1, Math.floor(Number(pageNumber) || 1)));
        const page = await pdf.getPage(number);
        try {
            const base = page.getViewport({ scale: 1 });
            // Very tall pages are capped so a page image never gets huge
            const scale = Math.min(PREVIEW_PDF_PAGE_WIDTH / base.width, 6000 / base.height, 4);
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.floor(viewport.width));
            canvas.height = Math.max(1, Math.floor(viewport.height));
            const context = canvas.getContext('2d');
            context.fillStyle = '#ffffff'; // Pages are paper-white in both themes
            context.fillRect(0, 0, canvas.width, canvas.height);
            // 'print' draws without waiting for animation frames, which browsers pause while
            // One-Host is in a background tab, as it often is on the sending device
            await page.render({ canvasContext: context, viewport, intent: 'print' }).promise;
            const { width, height } = canvas;
            const out = await this.encodeCanvas(canvas, false);
            return {
                kind: 'pdf', page: number, pageCount: pdf.numPages,
                data: local ? out : await out.arrayBuffer(), mime: out.type, width, height
            };
        } finally {
            page.cleanup();
        }
    }

    async readSheets(blob) {
        const XLSX = await this.loadLibrary('xlsx');
        let workbook;
        try {
            workbook = XLSX.read(await blob.arrayBuffer(), {
                type: 'array', sheetRows: PREVIEW_SHEET_MAX_ROWS, cellDates: true, cellStyles: false
            });
        } catch (error) {
            throw new PreviewUnavailableError('This spreadsheet couldn\'t be read.');
        }
        let budget = PREVIEW_SHEET_MAX_CHARS;
        const sheets = workbook.SheetNames.slice(0, PREVIEW_SHEET_MAX_SHEETS).map(name => {
            const sheet = workbook.Sheets[name];
            // !fullref is the sheet's whole range; !ref only covers the rows that were read
            const fullRef = sheet['!fullref'] || sheet['!ref'];
            const full = fullRef ? XLSX.utils.decode_range(fullRef) : null;
            const rows = [];
            const all = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '', blankrows: true });
            for (const row of all) {
                if (budget <= 0) break;
                const cells = row.slice(0, PREVIEW_SHEET_MAX_COLS).map(cell => String(cell ?? '').slice(0, 300));
                budget -= cells.reduce((sum, cell) => sum + cell.length + 1, 0);
                rows.push(cells);
            }
            return {
                name: String(name),
                rows,
                totalRows: full ? full.e.r + 1 : rows.length,
                totalCols: full ? full.e.c + 1 : 0
            };
        });
        return { kind: 'sheet', sheets, sheetCount: workbook.SheetNames.length };
    }

    async readDocx(blob) {
        const mammoth = await this.loadLibrary('mammoth');
        let budget = PREVIEW_DOC_IMAGE_BUDGET;
        // Pictures go inline as data URLs while they fit the budget; the rest are left out
        const convertImage = mammoth.images.imgElement(async (image) => {
            if (!SAFE_IMAGE_TYPES.test(image.contentType || '')) return { src: '' };
            const base64 = await image.read('base64');
            if (base64.length > budget) return { src: '' };
            budget -= base64.length;
            return { src: `data:${image.contentType};base64,${base64}` };
        });
        let result;
        try {
            result = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() }, { convertImage });
        } catch (error) {
            throw new PreviewUnavailableError('This document couldn\'t be read.');
        }
        const html = String(result.value || '');
        if (!html.trim()) throw new PreviewUnavailableError('This document looks empty.');
        return { kind: 'document', html: html.slice(0, PREVIEW_DOCX_MAX_HTML) };
    }

    // ---- Shared helpers for zip-based documents ----

    async openZip(blob, message) {
        if (typeof JSZip === 'undefined') throw new PreviewUnavailableError('Preview isn\'t available.');
        try {
            return await JSZip.loadAsync(blob);
        } catch (error) {
            throw new PreviewUnavailableError(message);
        }
    }

    async zipXml(zip, path, type = 'application/xml') {
        const file = path && zip.file(path);
        if (!file) return null;
        const doc = new DOMParser().parseFromString(await file.async('string'), type);
        return doc.getElementsByTagName('parsererror').length ? null : doc;
    }

    // A relative link inside a package, resolved against the folder of the part it's in
    resolvePath(folder, target) {
        const path = (target || '').split('#')[0];
        const parts = (path.startsWith('/') ? path.slice(1) : folder + path).split('/');
        const resolved = [];
        parts.forEach(part => part === '..' ? resolved.pop() : (part && part !== '.' && resolved.push(part)));
        return resolved.map(part => { try { return decodeURIComponent(part); } catch (e) { return part; } }).join('/');
    }

    // A picture from a package, made smaller; null when it's missing, unsupported or over budget
    async zipImage(zip, path, maxSide, budget) {
        const file = path && zip.file(path);
        const mime = PREVIEW_MIME_TYPES[this.getExtension(path || '')];
        if (!file || !mime || !SAFE_IMAGE_TYPES.test(mime) || budget.left <= 0) return null;
        try {
            const reduced = await this.reduceImage(await file.async('blob'), mime, maxSide);
            if (reduced.data.byteLength > budget.left) return null;
            budget.left -= reduced.data.byteLength;
            return { data: reduced.data, mime: reduced.mime };
        } catch (error) {
            return null; // A picture the browser can't decode is just left out
        }
    }

    toDataUrl(image) {
        const bytes = new Uint8Array(image.data);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return `data:${image.mime};base64,${btoa(binary)}`;
    }

    async startsWith(blob, text) {
        const head = new Uint8Array(await blob.slice(0, text.length).arrayBuffer());
        return [...text].every((ch, i) => head[i] === ch.charCodeAt(0));
    }

    // ---- Images that need converting ----

    async convertImage(blob, mime) {
        if (/photoshop/.test(mime)) return this.readPhotoshop(blob);
        try {
            return await this.reduceImage(blob, mime); // Safari decodes HEIC and TIFF itself
        } catch (error) {
            if (/tiff/.test(mime)) return this.readTiff(blob);
            // HEIC this browser can't decode: send it as it is, Safari receivers can still show it
            if (/heic|heif/.test(mime) && blob.size <= PREVIEW_IMAGE_SEND_ORIGINAL) {
                return { kind: 'image', data: await blob.arrayBuffer(), mime, reduced: false };
            }
            throw error;
        }
    }

    async imageFromPixels(width, height, rgba) {
        const full = document.createElement('canvas');
        full.width = width;
        full.height = height;
        full.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, width * height * 4), width, height), 0, 0);
        const scale = Math.min(1, PREVIEW_IMAGE_MAX_SIDE / Math.max(width, height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        canvas.getContext('2d').drawImage(full, 0, 0, canvas.width, canvas.height);
        full.width = full.height = 0; // Free the full-size pixels now
        const out = await this.encodeCanvas(canvas, true);
        return { kind: 'image', data: await out.arrayBuffer(), mime: out.type, reduced: true };
    }

    async readTiff(blob) {
        const UTIF = await this.loadLibrary('utif');
        try {
            const buffer = await blob.arrayBuffer();
            const ifds = UTIF.decode(buffer);
            const page = ifds.find(ifd => ifd.t256 && ifd.t257) || ifds[0]; // First page with a size
            UTIF.decodeImage(buffer, page, ifds);
            const max = PREVIEW_PSD_MAX_PIXELS[this.isMobile() ? 'mobile' : 'desktop'];
            if (!page.width || !page.height || page.width * page.height > max) throw new Error('Too large');
            return await this.imageFromPixels(page.width, page.height, UTIF.toRGBA8(page));
        } catch (error) {
            console.warn('TIFF not decoded:', error);
            throw new PreviewUnavailableError('This TIFF couldn\'t be previewed.');
        }
    }

    async readPhotoshop(blob) {
        let result;
        try {
            const max = PREVIEW_PSD_MAX_PIXELS[this.isMobile() ? 'mobile' : 'desktop'];
            result = LegacyFormats.photoshop(new Uint8Array(await blob.arrayBuffer()), max);
        } catch (error) {
            console.warn('PSD not decoded:', error);
            throw new PreviewUnavailableError('This Photoshop file couldn\'t be previewed.');
        }
        if (result.thumbnail) {
            return { kind: 'image', data: result.thumbnail.buffer, mime: 'image/jpeg', reduced: true, note: 'thumbnail' };
        }
        return this.imageFromPixels(result.width, result.height, result.rgba);
    }

    // ---- Archives ----

    async listTar(blob, gzipped) {
        try {
            return { kind: 'archive', ...(await LegacyFormats.tarEntries(blob, gzipped, PREVIEW_ZIP_MAX_ENTRIES)) };
        } catch (error) {
            console.warn('tar not read:', error);
            throw new PreviewUnavailableError('This archive couldn\'t be read.');
        }
    }

    // ---- Documents ----

    async readDocument(blob, ext) {
        // Files are sometimes named with the wrong extension; trust what's inside
        if (await this.startsWith(blob, '{\\rtf')) return this.readRtf(blob);
        const isZip = await this.startsWith(blob, 'PK');
        if (ext === 'pages') return this.readIworkPreview(blob);
        if (ext === 'epub') return this.readEpub(blob);
        if (ext === 'odt' || ext === 'ott') return this.readOpenDocumentText(blob);
        if (ext === 'msg') return this.readOutlookMessage(blob);
        if (isZip) return this.readDocx(blob);
        if (ext === 'rtf') return this.readRtf(blob);
        return this.readWordBinary(blob);
    }

    async readCompoundFile(blob, message) {
        const XLSX = await this.loadLibrary('xlsx');
        try {
            return { XLSX, cfb: LegacyFormats.openCompoundFile(new Uint8Array(await blob.arrayBuffer()), XLSX) };
        } catch (error) {
            throw new PreviewUnavailableError(message);
        }
    }

    async readWordBinary(blob) {
        const { XLSX, cfb } = await this.readCompoundFile(blob, 'This document couldn\'t be read.');
        let text;
        try {
            text = LegacyFormats.wordText(cfb, XLSX);
        } catch (error) {
            console.warn('Word 97-2003 text not read:', error);
            throw new PreviewUnavailableError(error.message === 'Encrypted'
                ? 'This document is password protected.'
                : 'This document couldn\'t be read.');
        }
        const html = LegacyFormats.textToHtml(text);
        if (!html) throw new PreviewUnavailableError('This document looks empty.');
        return { kind: 'document', html };
    }

    async readRtf(blob) {
        const html = LegacyFormats.textToHtml(LegacyFormats.rtfText(new Uint8Array(await blob.arrayBuffer())));
        if (!html) throw new PreviewUnavailableError('This document looks empty.');
        return { kind: 'document', html };
    }

    async readOutlookMessage(blob) {
        const { XLSX, cfb } = await this.readCompoundFile(blob, 'This message couldn\'t be read.');
        let message;
        try {
            message = LegacyFormats.outlookMessage(cfb, XLSX);
        } catch (error) {
            throw new PreviewUnavailableError('This message couldn\'t be read.');
        }
        const escape = (text) => LegacyFormats.escapeHtml(text);
        const rows = [['From', message.from], ['To', message.to], ['Cc', message.cc], ['Subject', message.subject]]
            .filter(([, value]) => value)
            .map(([label, value]) => `<tr><th>${label}</th><td>${escape(value)}</td></tr>`)
            .join('');
        return { kind: 'document', html: `<table>${rows}</table><hr>${LegacyFormats.textToHtml(message.body)}` };
    }

    async readOpenDocumentText(blob) {
        const zip = await this.openZip(blob, 'This document couldn\'t be read.');
        const content = await this.zipXml(zip, 'content.xml');
        if (!content) throw new PreviewUnavailableError('This document couldn\'t be read.');
        const budget = { left: PREVIEW_DOC_IMAGE_BUDGET };
        try {
            const html = await LegacyFormats.openDocumentHtml(content, async (href) => {
                const image = await this.zipImage(zip, this.resolvePath('', href), PREVIEW_IMAGE_MAX_SIDE / 2, budget);
                return image ? this.toDataUrl(image) : null;
            });
            if (!html.replace(/<[^>]*>/g, '').trim() && !html.includes('<img')) {
                throw new PreviewUnavailableError('This document looks empty.');
            }
            return { kind: 'document', html: html.slice(0, PREVIEW_DOCX_MAX_HTML) };
        } catch (error) {
            if (error instanceof PreviewUnavailableError) throw error;
            throw new PreviewUnavailableError('This document couldn\'t be read.');
        }
    }

    // E-books: the cover and the chapters in reading order, until the size limit
    async readEpub(blob) {
        const zip = await this.openZip(blob, 'This e-book couldn\'t be read.');
        const container = await this.zipXml(zip, 'META-INF/container.xml');
        const opfPath = container?.getElementsByTagName('rootfile')[0]?.getAttribute('full-path');
        const opf = await this.zipXml(zip, opfPath);
        if (!opf) throw new PreviewUnavailableError('This e-book couldn\'t be read.');
        const folder = opfPath.slice(0, opfPath.lastIndexOf('/') + 1);
        const manifest = {};
        for (const item of opf.getElementsByTagName('item')) {
            manifest[item.getAttribute('id')] = {
                path: this.resolvePath(folder, item.getAttribute('href')),
                type: item.getAttribute('media-type') || '',
                properties: item.getAttribute('properties') || ''
            };
        }
        const budget = { left: PREVIEW_DOC_IMAGE_BUDGET };
        let html = '';

        const coverMeta = [...opf.getElementsByTagName('meta')].find(meta => meta.getAttribute('name') === 'cover');
        const cover = Object.values(manifest).find(item => /cover-image/.test(item.properties)) ||
            (coverMeta && manifest[coverMeta.getAttribute('content')]);
        const coverImage = cover && await this.zipImage(zip, cover.path, 800, budget);
        if (coverImage) html += `<p><img src="${this.toDataUrl(coverImage)}"></p>`;

        const spine = [...opf.getElementsByTagName('itemref')].map(ref => manifest[ref.getAttribute('idref')]).filter(Boolean);
        let shown = 0;
        for (const item of spine) {
            if (html.length > PREVIEW_DOCX_MAX_HTML || !/html|xml/.test(item.type)) continue;
            const chapter = await this.zipXml(zip, item.path, 'application/xhtml+xml') ||
                await this.zipXml(zip, item.path, 'text/html');
            const body = chapter?.getElementsByTagName('body')[0];
            if (!body) continue;
            // Pictures in the chapter become data URLs while the budget lasts; the rest are dropped later
            const chapterFolder = item.path.slice(0, item.path.lastIndexOf('/') + 1);
            for (const img of [...body.getElementsByTagName('img')]) {
                const image = await this.zipImage(zip, this.resolvePath(chapterFolder, img.getAttribute('src')), 800, budget);
                if (image) img.setAttribute('src', this.toDataUrl(image));
            }
            const serializer = new XMLSerializer();
            html += [...body.childNodes].map(node => serializer.serializeToString(node)).join('');
            shown++;
        }
        if (!shown && !coverImage) throw new PreviewUnavailableError('This e-book looks empty.');
        if (shown < spine.length) html += '<p>… Preview ends here. Download the book to read all of it.</p>';
        return { kind: 'document', html: html.slice(0, PREVIEW_DOCX_MAX_HTML) };
    }

    // Pages, Keynote and Numbers keep a picture of the first page or slide in the package
    async readIworkPreview(blob) {
        const zip = await this.openZip(blob, 'This file couldn\'t be read.');
        const path = ['preview.jpg', 'QuickLook/Thumbnail.jpg', 'preview-web.jpg', 'preview-micro.jpg']
            .find(candidate => zip.file(candidate));
        const image = path && await this.zipImage(zip, path, PREVIEW_IMAGE_MAX_SIDE, { left: Infinity });
        if (!image) throw new PreviewUnavailableError('This file has no preview picture.');
        return { kind: 'image', data: image.data, mime: image.mime, reduced: true, note: 'first page' };
    }

    // ---- Slides ----

    async readSlides(blob, ext) {
        if (ext === 'key') return this.readIworkPreview(blob);
        if (ext === 'odp' || ext === 'otp') return this.readOpenDocumentSlides(blob);
        if (await this.startsWith(blob, 'PK')) return this.readPptx(blob);
        return this.readPowerPointBinary(blob);
    }

    async readPowerPointBinary(blob) {
        const { XLSX, cfb } = await this.readCompoundFile(blob, 'This presentation couldn\'t be read.');
        let slides;
        try {
            slides = LegacyFormats.powerPointSlides(cfb, XLSX);
        } catch (error) {
            console.warn('PowerPoint 97-2003 text not read:', error);
            throw new PreviewUnavailableError('This presentation couldn\'t be read.');
        }
        return {
            kind: 'slides', thumbnail: null, slideCount: slides.length,
            slides: slides.slice(0, PREVIEW_PPTX_MAX_SLIDES).map(slide => ({ ...slide, image: null }))
        };
    }

    async readOpenDocumentSlides(blob) {
        const zip = await this.openZip(blob, 'This presentation couldn\'t be read.');
        const content = await this.zipXml(zip, 'content.xml');
        if (!content) throw new PreviewUnavailableError('This presentation couldn\'t be read.');
        const budget = { left: PREVIEW_DOC_IMAGE_BUDGET };
        const thumbnail = await this.zipImage(zip, 'Thumbnails/thumbnail.png', 1024, budget);
        const pages = LegacyFormats.openDocumentSlides(content);
        if (!pages.length) throw new PreviewUnavailableError('This presentation has no slides.');
        const slides = [];
        for (const page of pages.slice(0, PREVIEW_PPTX_MAX_SLIDES)) {
            const image = page.imageHref
                ? await this.zipImage(zip, this.resolvePath('', page.imageHref), PREVIEW_PPTX_IMAGE_SIDE, budget)
                : null;
            slides.push({ title: page.title, texts: page.texts, image });
        }
        return { kind: 'slides', thumbnail, slides, slideCount: pages.length };
    }

    async readPptx(blob) {
        const zip = await this.openZip(blob, 'This presentation couldn\'t be read.');
        // Relationship id -> target path, resolved against the folder of the part that owns them
        const readRels = async (partPath) => {
            const folder = partPath.slice(0, partPath.lastIndexOf('/') + 1);
            const name = partPath.slice(folder.length);
            const doc = await this.zipXml(zip, `${folder}_rels/${name}.rels`);
            const rels = {};
            if (!doc) return rels;
            for (const rel of doc.getElementsByTagName('Relationship')) {
                rels[rel.getAttribute('Id')] = this.resolvePath(folder, rel.getAttribute('Target'));
            }
            return rels;
        };
        const textOf = (node) => [...node.getElementsByTagName('a:t')].map(t => t.textContent).join('');
        const budget = { left: PREVIEW_DOC_IMAGE_BUDGET };

        // Slide order comes from the presentation's slide list
        const presentation = await this.zipXml(zip, 'ppt/presentation.xml');
        const presentationRels = await readRels('ppt/presentation.xml');
        let slidePaths = presentation
            ? [...presentation.getElementsByTagName('p:sldId')]
                .map(node => presentationRels[node.getAttribute('r:id')])
                .filter(path => path && zip.file(path))
            : [];
        if (!slidePaths.length) {
            slidePaths = Object.keys(zip.files).filter(path => /^ppt\/slides\/slide\d+\.xml$/.test(path))
                .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
        }
        if (!slidePaths.length) throw new PreviewUnavailableError('This presentation has no slides.');

        const thumbnailPath = Object.keys(zip.files).find(path => /^docProps\/thumbnail\.(jpe?g|png)$/i.test(path));
        const thumbnail = await this.zipImage(zip, thumbnailPath, 1024, budget);

        const slides = [];
        for (const path of slidePaths.slice(0, PREVIEW_PPTX_MAX_SLIDES)) {
            const doc = await this.zipXml(zip, path);
            if (!doc) {
                slides.push({ title: '', texts: [], image: null });
                continue;
            }
            let title = '';
            const texts = [];
            for (const shape of doc.getElementsByTagName('p:sp')) {
                const placeholder = shape.getElementsByTagName('p:ph')[0];
                const isTitle = placeholder && /^(title|ctrTitle)$/.test(placeholder.getAttribute('type') || '');
                for (const paragraph of shape.getElementsByTagName('a:p')) {
                    const text = textOf(paragraph).trim().slice(0, 300);
                    if (!text) continue;
                    if (isTitle && !title) title = text;
                    else if (texts.length < 50) texts.push(text);
                }
            }
            const blip = doc.getElementsByTagName('a:blip')[0];
            const imagePath = blip ? (await readRels(path))[blip.getAttribute('r:embed')] : null;
            slides.push({ title, texts, image: await this.zipImage(zip, imagePath, PREVIEW_PPTX_IMAGE_SIDE, budget) });
        }
        return { kind: 'slides', thumbnail, slides, slideCount: slidePaths.length };
    }

    // ---- Overlay ----

    /**
     * Open the preview.
     * @param {{id, name, type, size}} fileInfo
     * @param {object} options
     * @param {Blob} [options.blob] - The file itself, for files this device sent
     * @param {(part, signal) => Promise<object>} [options.requestPreview] - Asks the sender of a
     *     received file for a preview (see createPreview); part is { offset } for more text
     *     or { page } for a PDF page
     * @param {(start, end) => Promise<{data, total}>} [options.requestRange] - Fetches a byte range
     *     of a received file from its sender, for streaming video and audio
     * @param {() => void} [options.save] - Downloads the file
     */
    open(fileInfo, { blob = null, requestPreview = null, requestRange = null, save = null } = {}) {
        // Opening over another preview reuses its history entry
        this.close({ keepHistory: true });
        this.build();

        const kind = this.getPreviewKind(fileInfo.name, fileInfo.type);
        const controller = new AbortController();
        const loadPart = blob
            ? (part) => this.createPreview(blob, fileInfo.name, fileInfo.type || blob.type, { ...part, local: true })
            : requestPreview;
        this.session = {
            fileInfo, kind, save, controller, loadPart,
            urls: [], zoom: 1, zoomKind: null, pointers: new Map(), pinch: null
        };

        this.title.textContent = fileInfo.name;
        this.subtitle.textContent = this.formatSize(fileInfo.size);
        this.saveButton.hidden = !save;
        this.setZoomControls(false);
        this.stage.className = 'preview-stage';
        this.stage.replaceChildren();

        this.overlay.hidden = false;
        document.body.classList.add('preview-open');
        // The phone's back button closes the preview instead of leaving the page (and its connections)
        if (history.state && history.state.filePreview) {
            history.replaceState({ filePreview: true }, '');
        } else {
            history.pushState({ filePreview: true }, '');
        }
        window.addEventListener('popstate', this.onPopState);
        document.addEventListener('keydown', this.onKeyDown);
        this.closeButton.focus();

        if (typeof Analytics !== 'undefined') {
            Analytics.track('file_preview_opened', {
                preview_kind: kind || 'none',
                file_type: this.getExtension(fileInfo.name),
                source: blob ? 'sent' : 'received'
            });
        }

        if (!kind) {
            this.showUnavailable('This file type can\'t be previewed.');
            return;
        }
        if (kind === 'video' || kind === 'audio') {
            // Sent: play this device's own copy. Received: stream it from the sender
            if (blob) this.renderMedia(blob, kind);
            else if (requestRange) this.streamMedia(kind, requestRange);
            else this.showUnavailable(`This ${kind} can't be played here.`);
            return;
        }
        if (!loadPart) {
            this.showUnavailable('The file isn\'t available.');
            return;
        }

        this.showLoading();
        const session = this.session;
        loadPart({}, controller.signal).then(preview => {
            if (this.session === session) return this.renderPreview(preview);
        }).catch(error => {
            if (this.session !== session || error.name === 'AbortError') return;
            console.warn('Preview unavailable:', error);
            this.showUnavailable(error instanceof PreviewUnavailableError ? error.message : '');
        });
    }

    close({ fromHistory = false, keepHistory = false } = {}) {
        if (!this.session) return;
        const session = this.session;
        this.session = null;
        session.controller.abort();
        if (session.observer) session.observer.disconnect();
        if (session.streamId) this.streams.delete(session.streamId); // Pieces still asked for are refused
        session.urls.forEach(url => URL.revokeObjectURL(url));

        if (document.fullscreenElement && this.overlay.contains(document.fullscreenElement)) {
            document.exitFullscreen().catch(() => {});
        }
        this.stage.querySelectorAll('video, audio').forEach(media => {
            media.pause();
            media.removeAttribute('src'); // Stops the player loading any more
            media.load();
        });
        this.stage.replaceChildren();
        this.overlay.hidden = true;
        document.body.classList.remove('preview-open');
        window.removeEventListener('popstate', this.onPopState);
        document.removeEventListener('keydown', this.onKeyDown);
        // Drop the history entry added on open, unless the back button already did
        if (!fromHistory && !keepHistory && history.state && history.state.filePreview) {
            history.back();
        }
    }

    onPopState() {
        // A late popstate from closing an earlier preview can land on this preview's entry
        if (history.state && history.state.filePreview) return;
        this.close({ fromHistory: true });
    }

    onKeyDown(e) {
        if (!this.session) return;
        if (e.key === 'Escape') {
            // Leaving fullscreen with Escape shouldn't also close the preview
            if (!document.fullscreenElement) this.close();
            return;
        }
        if (!this.session.zoomKind || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.target instanceof HTMLInputElement) return;
        if (e.key === '+' || e.key === '=') { e.preventDefault(); this.zoomBy(ZOOM_STEP); }
        else if (e.key === '-' || e.key === '_') { e.preventDefault(); this.zoomBy(1 / ZOOM_STEP); }
        else if (e.key === '0') { e.preventDefault(); this.setZoom(1); }
    }

    build() {
        if (this.overlay) return;
        const overlay = document.createElement('div');
        overlay.className = 'file-preview-overlay';
        overlay.hidden = true;
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'file-preview-title');
        overlay.innerHTML = `
            <div class="preview-header">
                <div class="preview-heading">
                    <span class="preview-title" id="file-preview-title" translate="no"></span>
                    <span class="preview-subtitle" translate="no"></span>
                </div>
                <button type="button" class="preview-action preview-save" title="Download file" aria-label="Download file">
                    <span class="material-icons" translate="no">download</span>
                </button>
                <button type="button" class="preview-action preview-close" title="Close preview" aria-label="Close preview">
                    <span class="material-icons" translate="no">close</span>
                </button>
            </div>
            <div class="preview-stage"></div>
            <div class="preview-zoom" hidden>
                <button type="button" class="preview-action" data-zoom="out" title="Zoom out" aria-label="Zoom out">
                    <span class="material-icons" translate="no">zoom_out</span>
                </button>
                <button type="button" class="preview-zoom-level" data-zoom="reset" title="Fit to screen" aria-label="Fit to screen">100%</button>
                <button type="button" class="preview-action" data-zoom="in" title="Zoom in" aria-label="Zoom in">
                    <span class="material-icons" translate="no">zoom_in</span>
                </button>
            </div>`;
        document.body.appendChild(overlay);

        this.overlay = overlay;
        this.title = overlay.querySelector('.preview-title');
        this.subtitle = overlay.querySelector('.preview-subtitle');
        this.stage = overlay.querySelector('.preview-stage');
        this.saveButton = overlay.querySelector('.preview-save');
        this.closeButton = overlay.querySelector('.preview-close');
        this.zoomBar = overlay.querySelector('.preview-zoom');
        this.zoomLevel = overlay.querySelector('.preview-zoom-level');

        this.closeButton.addEventListener('click', () => this.close());
        this.saveButton.addEventListener('click', () => {
            const session = this.session;
            if (session && session.save) session.save();
        });
        this.zoomBar.addEventListener('click', (e) => {
            const action = e.target.closest('[data-zoom]')?.dataset.zoom;
            if (action === 'in') this.zoomBy(ZOOM_STEP);
            else if (action === 'out') this.zoomBy(1 / ZOOM_STEP);
            else if (action === 'reset') this.setZoom(1);
        });
        // Clicking the dark area around a picture or player closes the preview
        this.stage.addEventListener('click', (e) => {
            const backdrop = e.target === this.stage || e.target.classList.contains('preview-media');
            if (backdrop && !this.session?.zoomKind) this.close();
        });
        this.setUpGestures();
    }

    showLoading() {
        const box = document.createElement('div');
        box.className = 'preview-message preview-loading';
        box.innerHTML = `
            <div class="preview-spinner" aria-hidden="true"></div>
            <span class="preview-message-title">Loading preview…</span>`;
        this.stage.className = 'preview-stage';
        this.stage.replaceChildren(box);
    }

    showUnavailable(reason) {
        this.setZoomControls(false);
        if (this.session) this.session.zoomKind = null;
        const box = document.createElement('div');
        box.className = 'preview-message';
        box.innerHTML = `
            <span class="material-icons preview-message-icon" translate="no">visibility_off</span>
            <span class="preview-message-title">Preview unavailable</span>
            <span class="preview-message-text"></span>`;
        box.querySelector('.preview-message-text').textContent = reason || '';
        this.stage.className = 'preview-stage';
        this.stage.replaceChildren(box);
    }

    // ---- Renderers ----

    // Shows a preview from createPreview. A received one came from another device, so only the
    // fields each kind needs are used, and only as an image, plain text or text labels.
    async renderPreview(preview) {
        const session = this.session;
        try {
            const accepted = PREVIEW_ACCEPTED_KINDS[session.kind] || [session.kind];
            if (!preview || !accepted.includes(preview.kind)) throw new Error('Unexpected preview');
            switch (preview.kind) {
                case 'image': await this.renderImage(preview); break;
                case 'text': this.renderText(preview); break;
                case 'archive': this.renderZip(preview); break;
                case 'pdf': this.renderPdf(preview); break;
                case 'sheet': this.renderSheets(preview); break;
                case 'document': this.renderDocx(preview); break;
                case 'slides': this.renderPptx(preview); break;
            }
        } catch (error) {
            if (this.session !== session) return;
            console.warn('Preview render failed:', error);
            this.showUnavailable('This browser can\'t display this file.');
        }
    }

    trackUrl(blob) {
        const url = URL.createObjectURL(blob);
        this.session.urls.push(url);
        return url;
    }

    renderImage(preview) {
        const session = this.session;
        const mime = String(preview.mime || '');
        if (!mime.startsWith('image/')) throw new Error('Not an image');
        const blob = preview.data instanceof Blob && preview.data.type === mime
            ? preview.data
            : new Blob([preview.data], { type: mime });
        const note = preview.note === 'first page' ? 'first page preview'
            : preview.note === 'thumbnail' ? 'thumbnail preview'
            : preview.reduced ? 'reduced preview' : '';
        if (note) this.subtitle.textContent = `${this.formatSize(session.fileInfo.size)} · ${note}`;

        return new Promise((resolve, reject) => {
            const img = new Image();
            img.className = 'preview-image';
            img.alt = session.fileInfo.name;
            img.draggable = false;
            img.onload = () => {
                if (this.session !== session) return resolve();
                const content = document.createElement('div');
                content.className = 'preview-content';
                content.appendChild(img);
                this.stage.className = 'preview-stage preview-stage-zoomable';
                this.stage.replaceChildren(content);
                session.zoomKind = 'image';
                session.natural = { width: img.naturalWidth || 800, height: img.naturalHeight || 600 };
                this.setZoomControls(true);
                this.setZoom(1);
                resolve();
            };
            img.onerror = () => reject(new Error('Image could not be decoded'));
            img.src = this.trackUrl(blob); // SVG shown as an image never runs scripts
        });
    }

    renderMedia(blob, tag) {
        const mime = this.getMimeType(this.session.fileInfo.name, blob.type);
        this.renderMediaSource(this.trackUrl(mime && blob.type !== mime ? new Blob([blob], { type: mime }) : blob), tag, false);
    }

    renderMediaSource(src, tag, streamed) {
        const media = document.createElement(tag);
        media.className = `preview-${tag}`;
        media.controls = true;
        media.preload = 'metadata';
        if (tag === 'video') {
            media.playsInline = true; // iPhone: play inline, fullscreen only when asked
            media.setAttribute('webkit-playsinline', '');
        }
        media.addEventListener('error', () => {
            if (!this.session || !this.stage.contains(media)) return;
            if (this.session.streamId) this.streams.delete(this.session.streamId); // Stop serving it
            // A network error while streaming means the sender stopped answering
            const network = streamed && media.error && media.error.code === MediaError.MEDIA_ERR_NETWORK;
            this.showUnavailable(network
                ? `The ${tag} stopped streaming. The sender may have disconnected.`
                : `This browser can't play this ${tag} format.`);
        });
        media.src = src;

        const wrapper = document.createElement('div');
        wrapper.className = `preview-media preview-media-${tag}`;
        if (tag === 'audio') {
            const icon = document.createElement('span');
            icon.className = 'material-icons preview-audio-icon';
            icon.setAttribute('translate', 'no');
            icon.textContent = 'audiotrack';
            wrapper.appendChild(icon);
        }
        wrapper.appendChild(media);
        this.stage.className = 'preview-stage';
        this.stage.replaceChildren(wrapper);
    }

    // First part of a text file; "Load more" asks for the next part and adds it below
    async renderText(preview) {
        const session = this.session;
        session.textDecoder = new TextDecoder('utf-8');
        const text = await this.decodeTextPart(preview);
        if (this.session !== session) return;
        // Binary data mislabelled as text would show as garbage
        if (text.slice(0, 4096).includes('\u0000')) {
            this.showUnavailable('This file doesn\'t contain readable text.');
            return;
        }

        const card = document.createElement('div');
        card.className = 'preview-text-card';
        const pre = document.createElement('pre');
        pre.className = 'preview-text';
        pre.setAttribute('translate', 'no');
        pre.textContent = text; // Never parsed as HTML
        card.appendChild(pre);
        this.showDocument(card, 'text');
        this.updateLoadMore(card, preview);
    }

    async decodeTextPart(preview) {
        const bytes = preview.data instanceof Blob ? await preview.data.arrayBuffer() : preview.data;
        const last = !(preview.nextOffset < preview.size);
        // stream: a character split between two parts is decoded once the next part arrives
        return this.session.textDecoder.decode(new Uint8Array(bytes), { stream: !last });
    }

    updateLoadMore(card, preview) {
        card.querySelector('.preview-load-more')?.remove();
        const nextOffset = Number(preview.nextOffset);
        const size = Number(preview.size);
        if (!(nextOffset < size)) return;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'preview-load-more';
        button.textContent = `Load more (${this.formatSize(nextOffset)} of ${this.formatSize(size)} shown)`;
        button.addEventListener('click', async () => {
            const session = this.session;
            button.disabled = true;
            button.textContent = 'Loading…';
            try {
                const next = await session.loadPart({ offset: nextOffset }, session.controller.signal);
                if (this.session !== session) return;
                if (!next || next.kind !== 'text' || Number(next.offset) !== nextOffset) throw new Error('Unexpected preview');
                card.querySelector('.preview-text').append(await this.decodeTextPart(next));
                this.updateLoadMore(card, next);
            } catch (error) {
                if (this.session !== session || error.name === 'AbortError') return;
                console.warn('Loading more text failed:', error);
                button.disabled = false;
                button.textContent = 'Couldn\'t load more. Tap to try again.';
            }
        });
        card.appendChild(button);
    }

    renderZip(preview) {
        const entries = Array.isArray(preview.entries) ? preview.entries : [];
        const count = Number(preview.count) || entries.length;

        const panel = document.createElement('div');
        panel.className = 'preview-zip';
        const summary = document.createElement('div');
        summary.className = 'preview-zip-summary';
        summary.textContent = `${count} file${count === 1 ? '' : 's'} · ${this.formatSize(Number(preview.total) || 0)} unpacked`;
        const list = document.createElement('ul');
        list.className = 'preview-zip-list';
        entries.slice(0, PREVIEW_ZIP_MAX_ENTRIES).forEach(entry => {
            const li = document.createElement('li');
            const icon = document.createElement('span');
            icon.className = 'material-icons';
            icon.setAttribute('translate', 'no');
            icon.textContent = 'insert_drive_file';
            const name = document.createElement('span');
            name.className = 'preview-zip-name';
            name.setAttribute('translate', 'no');
            name.textContent = String(entry && entry.name);
            const size = document.createElement('span');
            size.className = 'preview-zip-size';
            size.textContent = this.formatSize(Number(entry && entry.size) || 0);
            li.append(icon, name, size);
            list.appendChild(li);
        });
        panel.append(summary, list);
        if (count > entries.length) {
            const more = document.createElement('div');
            more.className = 'preview-zip-summary';
            more.textContent = `… and ${count - entries.length} more`;
            panel.appendChild(more);
        }
        this.showDocument(panel, 'archive');
    }

    // Text and zip listings: a readable card that zooms by scaling its text size
    // ---- PDF: one image per page, each asked for when it scrolls near the screen ----

    renderPdf(first) {
        const session = this.session;
        const pageCount = Math.max(1, Math.min(10000, Math.floor(Number(first.pageCount) || 1)));
        const ratio = (Number(first.height) || 1414) / (Number(first.width) || 1000);
        const pages = document.createElement('div');
        pages.className = 'preview-pages';
        const slots = [];
        for (let number = 1; number <= pageCount; number++) {
            const slot = document.createElement('div');
            slot.className = 'preview-page';
            slot.dataset.page = String(number);
            slot.style.aspectRatio = `1 / ${ratio}`; // Unloaded pages take the first page's shape
            const label = document.createElement('span');
            label.className = 'preview-page-label';
            label.textContent = `Page ${number}`;
            slot.appendChild(label);
            pages.appendChild(slot);
            slots.push(slot);
        }

        const content = document.createElement('div');
        content.className = 'preview-content preview-pdf';
        content.appendChild(pages);
        this.stage.className = 'preview-stage preview-stage-zoomable preview-stage-document';
        this.stage.replaceChildren(content);
        session.zoomKind = 'pdf';
        this.setZoomControls(true);
        this.setZoom(1);
        this.subtitle.textContent = `${this.formatSize(session.fileInfo.size)} · ${pageCount} page${pageCount === 1 ? '' : 's'}`;

        session.pdfQueue = [];
        session.pdfLoading = 0;
        this.showPdfPage(slots[0], first);
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const slot = entry.target;
                if (entry.isIntersecting && !slot.dataset.state) {
                    slot.dataset.state = 'queued';
                    session.pdfQueue.push(slot);
                    this.loadPdfPages(session);
                }
            });
        }, { root: this.stage, rootMargin: '800px 0px' });
        slots.slice(1).forEach(slot => observer.observe(slot));
        session.observer = observer;
    }

    // Two pages at a time, so the sender isn't asked to draw a whole document at once
    loadPdfPages(session) {
        while (this.session === session && session.pdfLoading < 2 && session.pdfQueue.length) {
            const slot = session.pdfQueue.shift();
            slot.dataset.state = 'loading';
            session.pdfLoading++;
            const number = Number(slot.dataset.page);
            session.loadPart({ page: number }, session.controller.signal).then(preview => {
                if (this.session !== session) return;
                if (!preview || preview.kind !== 'pdf' || Number(preview.page) !== number) throw new Error('Unexpected page');
                this.showPdfPage(slot, preview);
            }).catch(error => {
                if (this.session !== session || error.name === 'AbortError') return;
                console.warn(`PDF page ${number} failed:`, error);
                slot.dataset.state = 'failed';
                slot.querySelector('.preview-page-label').textContent = `Page ${number} couldn't be loaded. Tap to try again.`;
                slot.onclick = () => {
                    slot.onclick = null;
                    slot.dataset.state = 'queued';
                    slot.querySelector('.preview-page-label').textContent = `Page ${number}`;
                    session.pdfQueue.push(slot);
                    this.loadPdfPages(session);
                };
            }).finally(() => {
                session.pdfLoading--;
                this.loadPdfPages(session);
            });
        }
    }

    showPdfPage(slot, preview) {
        const mime = String(preview.mime || '');
        if (!mime.startsWith('image/')) throw new Error('Not an image');
        const blob = preview.data instanceof Blob ? preview.data : new Blob([preview.data], { type: mime });
        const img = new Image();
        img.className = 'preview-page-image';
        img.alt = `Page ${preview.page}`;
        img.draggable = false;
        img.src = this.trackUrl(blob);
        if (preview.width && preview.height) slot.style.aspectRatio = `${preview.width} / ${preview.height}`;
        slot.dataset.state = 'loaded';
        slot.replaceChildren(img);
    }

    // ---- Spreadsheet: read-only table per sheet, with tabs ----

    renderSheets(preview) {
        const sheets = Array.isArray(preview.sheets) ? preview.sheets : [];
        if (!sheets.length) throw new Error('No sheets');
        const panel = document.createElement('div');
        panel.className = 'preview-sheet';
        const tabs = document.createElement('div');
        tabs.className = 'preview-sheet-tabs';
        tabs.setAttribute('role', 'tablist');
        const body = document.createElement('div');
        body.className = 'preview-sheet-body';

        const show = (index) => {
            tabs.querySelectorAll('button').forEach((tab, i) => tab.setAttribute('aria-selected', String(i === index)));
            body.replaceChildren(this.buildSheetTable(sheets[index]));
        };
        sheets.forEach((sheet, index) => {
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.setAttribute('role', 'tab');
            tab.textContent = String(sheet && sheet.name || `Sheet ${index + 1}`);
            tab.addEventListener('click', () => show(index));
            tabs.appendChild(tab);
        });
        if (sheets.length > 1) panel.appendChild(tabs);
        panel.appendChild(body);
        const sheetCount = Number(preview.sheetCount) || sheets.length;
        if (sheetCount > sheets.length) {
            const more = document.createElement('div');
            more.className = 'preview-zip-summary';
            more.textContent = `Showing ${sheets.length} of ${sheetCount} sheets`;
            panel.appendChild(more);
        }
        this.showDocument(panel, 'sheet', { wide: true });
        show(0);
    }

    buildSheetTable(sheet) {
        const rows = Array.isArray(sheet && sheet.rows) ? sheet.rows : [];
        const width = rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
        const fragment = document.createDocumentFragment();
        if (!rows.length || !width) {
            const empty = document.createElement('div');
            empty.className = 'preview-zip-summary';
            empty.textContent = 'This sheet is empty.';
            fragment.appendChild(empty);
            return fragment;
        }
        const table = document.createElement('table');
        table.className = 'preview-table';
        const head = table.createTHead().insertRow();
        head.appendChild(document.createElement('th'));
        for (let col = 0; col < width; col++) {
            const th = document.createElement('th');
            th.textContent = this.columnName(col);
            head.appendChild(th);
        }
        const tbody = table.createTBody();
        rows.forEach((row, index) => {
            const tr = tbody.insertRow();
            const number = document.createElement('th');
            number.textContent = String(index + 1);
            tr.appendChild(number);
            for (let col = 0; col < width; col++) {
                tr.insertCell().textContent = Array.isArray(row) && row[col] != null ? String(row[col]) : '';
            }
        });
        fragment.appendChild(table);

        const totalRows = Number(sheet.totalRows) || rows.length;
        const totalCols = Number(sheet.totalCols) || width;
        if (totalRows > rows.length || totalCols > width) {
            const note = document.createElement('div');
            note.className = 'preview-zip-summary';
            note.textContent = `Showing ${rows.length.toLocaleString()} of ${totalRows.toLocaleString()} rows` +
                (totalCols > width ? ` and ${width} of ${totalCols} columns` : '');
            fragment.appendChild(note);
        }
        return fragment;
    }

    columnName(index) {
        let name = '';
        for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
            name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
        }
        return name;
    }

    // ---- Word: the sender's HTML, rebuilt here from allowed tags only ----

    renderDocx(preview) {
        const article = document.createElement('article');
        article.className = 'preview-docx';
        article.appendChild(this.sanitizeHtml(String(preview.html || '')));
        this.showDocument(article, 'document');
    }

    // Parsing in a separate document runs nothing and loads nothing. Only allowed tags are copied
    // across, with no attributes except table spans and data: URLs of safe image types.
    sanitizeHtml(html) {
        const source = new DOMParser().parseFromString(html, 'text/html');
        const fragment = document.createDocumentFragment();
        const copy = (node, parent) => {
            for (const child of node.childNodes) {
                if (child.nodeType === Node.TEXT_NODE) {
                    parent.appendChild(document.createTextNode(child.textContent));
                    continue;
                }
                if (child.nodeType !== Node.ELEMENT_NODE) continue;
                const tag = child.tagName.toUpperCase();
                if (DOCX_DROPPED_TAGS.has(tag)) continue;
                if (!DOCX_ALLOWED_TAGS.has(tag)) {
                    copy(child, parent); // Unknown wrapper (a link, a div): keep only what's inside
                    continue;
                }
                if (tag === 'IMG') {
                    const src = child.getAttribute('src') || '';
                    const match = src.match(/^data:(image\/[a-z]+);base64,[a-z0-9+/=\s]+$/i);
                    if (!match || !SAFE_IMAGE_TYPES.test(match[1].toLowerCase())) continue;
                    const img = document.createElement('img');
                    img.src = src;
                    img.alt = '';
                    parent.appendChild(img);
                    continue;
                }
                const element = document.createElement(tag.toLowerCase());
                if (tag === 'TD' || tag === 'TH') {
                    ['colspan', 'rowspan'].forEach(name => {
                        const value = parseInt(child.getAttribute(name), 10);
                        if (value > 1 && value < 1000) element.setAttribute(name, String(value));
                    });
                }
                copy(child, element);
                parent.appendChild(element);
            }
        };
        copy(source.body, fragment);
        return fragment;
    }

    // ---- PowerPoint: first-slide thumbnail and each slide's text and first picture ----

    renderPptx(preview) {
        const slides = Array.isArray(preview.slides) ? preview.slides : [];
        const panel = document.createElement('div');
        panel.className = 'preview-pptx';
        const imageOf = (picture, alt) => {
            const mime = String(picture && picture.mime || '');
            if (!picture || !SAFE_IMAGE_TYPES.test(mime)) return null;
            const img = document.createElement('img');
            img.alt = alt;
            img.draggable = false;
            img.src = this.trackUrl(new Blob([picture.data], { type: mime }));
            return img;
        };

        const note = document.createElement('div');
        note.className = 'preview-zip-summary';
        const slideCount = Number(preview.slideCount) || slides.length;
        note.textContent = `${slideCount} slide${slideCount === 1 ? '' : 's'} · text and pictures only, not the slide design`;
        panel.appendChild(note);

        const thumbnail = imageOf(preview.thumbnail, 'First slide');
        if (thumbnail) {
            const figure = document.createElement('figure');
            figure.className = 'preview-pptx-thumbnail';
            const caption = document.createElement('figcaption');
            caption.textContent = 'First slide';
            figure.append(thumbnail, caption);
            panel.appendChild(figure);
        }

        slides.forEach((slide, index) => {
            const section = document.createElement('section');
            section.className = 'preview-pptx-slide';
            const label = document.createElement('div');
            label.className = 'preview-pptx-number';
            label.textContent = `Slide ${index + 1}`;
            section.appendChild(label);
            if (slide && slide.title) {
                const title = document.createElement('h3');
                title.textContent = String(slide.title);
                section.appendChild(title);
            }
            const texts = Array.isArray(slide && slide.texts) ? slide.texts : [];
            if (texts.length) {
                const list = document.createElement('ul');
                texts.forEach(text => {
                    const li = document.createElement('li');
                    li.textContent = String(text);
                    list.appendChild(li);
                });
                section.appendChild(list);
            }
            const picture = imageOf(slide && slide.image, `Picture on slide ${index + 1}`);
            if (picture) section.appendChild(picture);
            if (!slide || (!slide.title && !texts.length && !picture)) {
                const empty = document.createElement('div');
                empty.className = 'preview-zip-summary';
                empty.textContent = 'No text on this slide';
                section.appendChild(empty);
            }
            panel.appendChild(section);
        });
        if (slideCount > slides.length) {
            const more = document.createElement('div');
            more.className = 'preview-zip-summary';
            more.textContent = `… and ${slideCount - slides.length} more slides`;
            panel.appendChild(more);
        }
        this.showDocument(panel, 'slides');
    }

    showDocument(element, zoomKind, { wide = false } = {}) {
        const content = document.createElement('div');
        content.className = `preview-content preview-document${wide ? ' preview-document-wide' : ''}`;
        content.appendChild(element);
        this.stage.className = 'preview-stage preview-stage-zoomable preview-stage-document';
        this.stage.replaceChildren(content);
        this.session.zoomKind = zoomKind;
        this.setZoomControls(true);
        this.setZoom(1);
    }

    // ---- Zoom ----

    setZoomControls(visible) {
        this.zoomBar.hidden = !visible;
    }

    zoomBy(factor, focusX, focusY) {
        if (this.session) this.setZoom(this.session.zoom * factor, focusX, focusY);
    }

    // zoom is relative to "fit": 1 means the picture fits the screen, or text at its normal size.
    // focusX/focusY (relative to the stage) stay under the finger or cursor while zooming.
    setZoom(zoom, focusX, focusY) {
        const session = this.session;
        if (!session || !session.zoomKind) return;
        const limits = ZOOM_LIMITS[session.zoomKind];
        const next = Math.min(limits.max, Math.max(limits.min, zoom));
        const stage = this.stage;
        const content = stage.firstElementChild;
        if (!content) return;

        const fx = focusX ?? stage.clientWidth / 2;
        const fy = focusY ?? stage.clientHeight / 2;
        const ratioX = (stage.scrollLeft + fx) / Math.max(1, stage.scrollWidth);
        const ratioY = (stage.scrollTop + fy) / Math.max(1, stage.scrollHeight);

        session.zoom = next;
        if (session.zoomKind === 'pdf') {
            // Pages fill a column that grows with the zoom; the stage scrolls once it's wider
            const base = Math.min(stage.clientWidth - 32, 900);
            content.style.width = `${Math.max(100, base * next)}px`;
        } else if (session.zoomKind === 'image') {
            const img = content.querySelector('img');
            const pad = 32;
            const fit = Math.min(
                (stage.clientWidth - pad) / session.natural.width,
                (stage.clientHeight - pad) / session.natural.height,
                1 // Small pictures aren't blown up to fit
            );
            img.style.width = `${Math.max(1, session.natural.width * fit * next)}px`;
            img.style.height = `${Math.max(1, session.natural.height * fit * next)}px`;
        } else {
            content.style.fontSize = `${next * 100}%`;
        }

        stage.scrollLeft = ratioX * stage.scrollWidth - fx;
        stage.scrollTop = ratioY * stage.scrollHeight - fy;
        this.zoomLevel.textContent = `${Math.round(next * 100)}%`;
    }

    setUpGestures() {
        const stage = this.stage;

        // Two-finger pinch (touch-action in CSS keeps one-finger scrolling native)
        stage.addEventListener('pointerdown', (e) => {
            const session = this.session;
            if (!session || !session.zoomKind || e.pointerType !== 'touch') return;
            session.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (session.pointers.size === 2) {
                const [a, b] = [...session.pointers.values()];
                session.pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: session.zoom };
            }
        });
        stage.addEventListener('pointermove', (e) => {
            const session = this.session;
            if (!session || !session.pointers.has(e.pointerId)) return;
            session.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (session.pinch && session.pointers.size === 2) {
                const [a, b] = [...session.pointers.values()];
                const rect = stage.getBoundingClientRect();
                const distance = Math.hypot(a.x - b.x, a.y - b.y);
                this.setZoom(session.pinch.zoom * distance / session.pinch.distance,
                    (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
            }
        });
        const endPointer = (e) => {
            const session = this.session;
            if (!session) return;
            session.pointers.delete(e.pointerId);
            if (session.pointers.size < 2) session.pinch = null;
        };
        stage.addEventListener('pointerup', endPointer);
        stage.addEventListener('pointercancel', endPointer);

        // Safari's own pinch gestures would zoom the whole page instead
        ['gesturestart', 'gesturechange'].forEach(type => {
            stage.addEventListener(type, (e) => { if (this.session?.zoomKind) e.preventDefault(); });
        });

        // Ctrl/Cmd + scroll, and trackpad pinch (which browsers report as Ctrl + scroll)
        stage.addEventListener('wheel', (e) => {
            if (!this.session?.zoomKind || !(e.ctrlKey || e.metaKey)) return;
            e.preventDefault();
            const rect = stage.getBoundingClientRect();
            // A mouse wheel notch is about 100, a trackpad pinch step a few units; cap a notch at ~1.6x
            const delta = Math.max(-50, Math.min(50, e.deltaY));
            this.zoomBy(Math.exp(-delta * 0.01), e.clientX - rect.left, e.clientY - rect.top);
        }, { passive: false });

        // Double-click / double-tap toggles between fit and 2x at that spot
        stage.addEventListener('dblclick', (e) => {
            if (this.session?.zoomKind !== 'image') return;
            const rect = stage.getBoundingClientRect();
            this.setZoom(this.session.zoom > 1.01 ? 1 : 2, e.clientX - rect.left, e.clientY - rect.top);
        });

        // Keep a fitted picture fitted when the screen rotates or the window resizes
        window.addEventListener('resize', () => {
            if (this.session?.zoomKind === 'image') this.setZoom(this.session.zoom);
        });
    }

    formatSize(bytes) {
        if (!bytes) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
        return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
    }
}

// Export for use in other modules or attach to window
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FilePreview;
} else {
    window.FilePreview = FilePreview;
    window.PreviewUnavailableError = PreviewUnavailableError;
    window.filePreview = new FilePreview();
}
