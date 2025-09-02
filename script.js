// Constants - now imported from config
const CHUNK_SIZE = window.CONFIG?.CHUNK_SIZE || 16384;
const DB_NAME = window.CONFIG?.DB_NAME || 'fileTransferDB';
const DB_VERSION = window.CONFIG?.DB_VERSION || 1;
const STORE_NAME = window.CONFIG?.STORE_NAME || 'files';
const KEEP_ALIVE_INTERVAL = window.CONFIG?.KEEP_ALIVE_INTERVAL || 30000;
const CONNECTION_TIMEOUT = window.CONFIG?.CONNECTION_TIMEOUT || 60000;

// Analytics Helper Functions
const Analytics = {
    // Safe tracking wrapper that never breaks functionality
    track: function(eventName, parameters = {}) {
        try {
            if (typeof gtag !== 'undefined' && gtag) {
                // Add common parameters to all events
                const eventParams = {
                    ...parameters,
                    app_version: '1.0.0',
                    environment: window.CONFIG?.ENVIRONMENT || 'production',
                    timestamp: Date.now(),
                    session_id: this.getSessionId()
                };
                
                // Send event to Google Analytics
                gtag('event', eventName, eventParams);
                console.debug(`📊 Analytics: ${eventName}`, eventParams);
            }
        } catch (error) {
            console.debug('Analytics tracking error (non-critical):', error);
            // Never throw or break main functionality
        }
    },

    // Get or create session ID
    getSessionId: function() {
        if (!this._sessionId) {
            this._sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        }
        return this._sessionId;
    },

    // Get file extension for categorization
    getFileExtension: function(filename) {
        return filename.split('.').pop().toLowerCase();
    },

    // Get file size category
    getFileSizeCategory: function(bytes) {
        if (bytes < 1024 * 1024) return 'small'; // < 1MB
        if (bytes < 10 * 1024 * 1024) return 'medium'; // < 10MB
        if (bytes < 100 * 1024 * 1024) return 'large'; // < 100MB
        return 'extra_large'; // >= 100MB
    },

    // Get device type
    getDeviceType: function() {
        const userAgent = navigator.userAgent.toLowerCase();
        if (/mobile|android|iphone|ipad|tablet/.test(userAgent)) {
            return 'mobile';
        }
        return 'desktop';
    },

    // Calculate transfer speed
    calculateSpeed: function(bytes, timeMs) {
        const speedBps = (bytes / timeMs) * 1000; // bytes per second
        return Math.round(speedBps / 1024 / 1024 * 100) / 100; // MB/s
    }
};

// Track page load and initialization
Analytics.track('app_initialized', {
    device_type: Analytics.getDeviceType(),
    user_agent: navigator.userAgent,
    screen_resolution: `${screen.width}x${screen.height}`,
    connection_type: navigator.connection?.effectiveType || 'unknown'
});

// Add simultaneous download message types
const MESSAGE_TYPES = {
    FILE_INFO: 'file-info',
    FILE_HEADER: 'file-header',
    FILE_CHUNK: 'file-chunk',
    FILE_COMPLETE: 'file-complete',
    BLOB_REQUEST: 'blob-request',
    BLOB_REQUEST_FORWARDED: 'blob-request-forwarded',
    BLOB_ERROR: 'blob-error',
    CONNECTION_NOTIFICATION: 'connection-notification',
    KEEP_ALIVE: 'keep-alive',
    KEEP_ALIVE_RESPONSE: 'keep-alive-response',
    DISCONNECT_NOTIFICATION: 'disconnect-notification',
    SIMULTANEOUS_DOWNLOAD_REQUEST: 'simultaneous-download-request',
    SIMULTANEOUS_DOWNLOAD_READY: 'simultaneous-download-ready',
    SIMULTANEOUS_DOWNLOAD_START: 'simultaneous-download-start'
};

// DOM Elements
const elements = {
    peerId: document.getElementById('peer-id'),
    copyId: document.getElementById('copy-id'),
    shareId: document.getElementById('share-id'),
    remotePeerId: document.getElementById('remote-peer-id'),
    connectButton: document.getElementById('connect-button'),
    fileInput: document.getElementById('file-input'),
    dropZone: document.getElementById('drop-zone'),
    transferProgress: document.getElementById('transfer-progress'),
    progress: document.getElementById('progress'),
    transferInfo: document.getElementById('transfer-info'),
    fileList: document.getElementById('file-list'),
    statusText: document.getElementById('status-text'),
    statusDot: document.getElementById('status-dot'),
    browserSupport: document.getElementById('browser-support'),
    fileTransferSection: document.getElementById('file-transfer-section'),
    qrcode: document.getElementById('qrcode'),
    receivedFiles: document.getElementById('received-files'),
    notifications: document.getElementById('notifications'),
    sentFilesList: document.getElementById('sent-files-list'),
    receivedFilesList: document.getElementById('received-files-list'),
    recentPeers: document.getElementById('recent-peers'),
    recentPeersList: document.getElementById('recent-peers-list'),
    clearPeers: document.getElementById('clear-peers'),
    // Add new elements for peer ID editing
    peerIdEdit: document.getElementById('peer-id-edit'),
    editIdButton: document.getElementById('edit-id'),
    saveIdButton: document.getElementById('save-id'),
    cancelEditButton: document.getElementById('cancel-edit'),
    // Social media elements
    socialToggle: document.getElementById('social-toggle'),
    socialIcons: document.getElementById('social-icons')
};

// State
let peer = null;
let connections = new Map(); // Map to store multiple connections
let db = null;
let transferInProgress = false;
let isConnectionReady = false;
let fileChunks = {}; // Initialize fileChunks object
let keepAliveInterval = null;
let connectionTimeouts = new Map();
let isPageVisible = true;

// Add file history tracking with Sets for uniqueness
const fileHistory = {
    sent: new Set(),
    received: new Set()
};

// Add blob storage for sent files
const sentFileBlobs = new Map(); // Map to store blobs of sent files

// Add recent peers tracking
let recentPeers = [];
const MAX_RECENT_PEERS = 5;

// Add file queue system
let fileQueue = [];
let isProcessingQueue = false;

// --- Remove notification-based progress ---
// Remove showProgressNotification, clearProgressNotification, and patch of updateProgress

// --- Download progress per file ---
const downloadProgressMap = new Map(); // fileId -> { button, percent }

// Patch updateFilesList to mark download buttons for received files
const originalUpdateFilesList = updateFilesList;
updateFilesList = function(listElement, fileInfo, type) {
    originalUpdateFilesList(listElement, fileInfo, type);
    if (type === 'received' || type === 'sent') {
        const li = listElement.querySelector(`[data-file-id="${fileInfo.id}"]`);
        if (li) {
            const downloadBtn = li.querySelector('.icon-button');
            if (downloadBtn) {
                downloadBtn.setAttribute('data-file-id', fileInfo.id);
            }
        }
        // Scroll to bottom after adding
        listElement.scrollTop = listElement.scrollHeight;
    }
};

// Patch requestAndDownloadBlob to set up progress UI
const originalRequestAndDownloadBlob = requestAndDownloadBlob;
requestAndDownloadBlob = async function(fileInfo) {
    const fileId = fileInfo.id;
    const btn = document.querySelector(`button.icon-button[data-file-id="${fileId}"]`);
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '0%';
        downloadProgressMap.set(fileId, { button: btn, percent: 0 });
    }
    await originalRequestAndDownloadBlob(fileInfo);
};

// Patch updateProgress to update button percentage for downloads
const originalUpdateProgress = updateProgress;
updateProgress = function(progress, fileId) {
    if (fileId && downloadProgressMap.has(fileId)) {
        const entry = downloadProgressMap.get(fileId);
        const percent = Math.floor(progress);
        if (entry.percent !== percent) {
            entry.button.innerHTML = `<span class='download-progress-text'>${percent}%</span>`;
            entry.percent = percent;
        }
    }
    originalUpdateProgress(progress);
};

// Patch handleFileComplete to swap to open file icon and enable open
const originalHandleFileComplete = handleFileComplete;
handleFileComplete = async function(data) {
    await originalHandleFileComplete(data);
    const fileId = data.fileId;
    if (downloadProgressMap.has(fileId)) {
        const entry = downloadProgressMap.get(fileId);
        entry.button.disabled = false;
        entry.button.innerHTML = '<span class="material-icons">open_in_new</span>';
        // The open logic is already set in downloadBlob
        downloadProgressMap.delete(fileId);
    }
};

// Load recent peers from localStorage
function loadRecentPeers() {
    try {
        const saved = localStorage.getItem('recentPeers');
        if (saved) {
            recentPeers = JSON.parse(saved);
            updateRecentPeersList();
        }
    } catch (error) {
        console.error('Error loading recent peers:', error);
    }
}

// Save recent peers to localStorage
function saveRecentPeers() {
    try {
        localStorage.setItem('recentPeers', JSON.stringify(recentPeers));
    } catch (error) {
        console.error('Error saving recent peers:', error);
    }
}

// Add a peer to recent peers list
function addRecentPeer(peerId) {
    const existingIndex = recentPeers.indexOf(peerId);
    if (existingIndex !== -1) {
        recentPeers.splice(existingIndex, 1);
    }
    recentPeers.unshift(peerId);
    if (recentPeers.length > MAX_RECENT_PEERS) {
        recentPeers.pop();
    }
    saveRecentPeers();
    updateRecentPeersList();
}

// Update the recent peers list UI
function updateRecentPeersList() {
    elements.recentPeersList.innerHTML = '';
    recentPeers.forEach(peerId => {
        const li = document.createElement('li');
        li.textContent = peerId;
        li.onclick = () => {
            elements.remotePeerId.value = peerId;
            elements.recentPeers.classList.add('hidden');
            elements.connectButton.click();
        };
        elements.recentPeersList.appendChild(li);
    });
}

// Check WebRTC Support
function checkBrowserSupport() {
    if (!window.RTCPeerConnection || !navigator.mediaDevices) {
        elements.browserSupport.classList.remove('hidden');
        return false;
    }
    return true;
}

// Initialize IndexedDB
async function initIndexedDB() {
    try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = (event) => {
            showNotification('IndexedDB initialization failed', 'error');
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };

        request.onsuccess = (event) => {
            db = event.target.result;
        };
    } catch (error) {
        console.error('IndexedDB Error:', error);
        showNotification('Storage initialization failed', 'error');
    }
}

// Generate QR Code
function generateQRCode(peerId) {
    try {
        if (!elements.qrcode) return;
        elements.qrcode.innerHTML = ''; // Clear previous QR code
        
        // Generate URL with peer ID as query parameter
        const baseUrl = window.CONFIG?.BASE_URL || (window.location.origin + window.location.pathname);
        const qrUrl = `${baseUrl}?peer=${peerId}`;
        
        new QRCode(elements.qrcode, {
            text: qrUrl,
            width: 128,
            height: 128,
            colorDark: '#2196F3',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
        });
    } catch (error) {
        console.error('QR Code Generation Error:', error);
    }
}

// Check URL for peer ID on load
function checkUrlForPeerId() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const peerId = urlParams.get('peer');
        
        if (peerId && peerId.length > 0) {
            // Track QR code scan/URL connection
            Analytics.track('qr_code_connection_detected', {
                peer_id_length: peerId.length,
                device_type: Analytics.getDeviceType(),
                referrer: document.referrer || 'direct'
            });
            
            elements.remotePeerId.value = peerId;
            // Wait a bit for PeerJS to initialize
            setTimeout(() => {
                elements.connectButton.click();
            }, 1500);
        }
    } catch (error) {
        console.error('Error parsing URL parameters:', error);
        Analytics.track('qr_code_connection_error', {
            error_message: error.message
        });
    }
}

// Store sent files for later download
const sentFilesStore = new Map();

// Initialize share button if Web Share API is available
function initShareButton() {
    if (navigator.share) {
        elements.shareId.classList.remove('hidden');
        elements.shareId.addEventListener('click', shareId);
    } else {
        elements.shareId.classList.add('hidden');
    }
}

// Share peer ID using Web Share API
async function shareId() {
    try {
        const peerId = elements.peerId.textContent;
        const baseUrl = window.CONFIG?.BASE_URL || 'https://one-host.app/';
        const qrUrl = `${baseUrl}?peer=${peerId}`;
        
        // Track share button click
        Analytics.track('peer_id_share_clicked', {
            peer_id_length: peerId.length,
            device_type: Analytics.getDeviceType(),
            share_method: 'web_share_api'
        });
        
        await navigator.share({ url: qrUrl });
        showNotification('Share successful!', 'success');
        
        // Track successful share
        Analytics.track('peer_id_shared_successfully', {
            peer_id_length: peerId.length,
            device_type: Analytics.getDeviceType(),
            share_method: 'web_share_api'
        });
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('Error sharing:', error);
            showNotification('Failed to share', 'error');
            
            // Track share failure
            Analytics.track('peer_id_share_failed', {
                error_type: error.name,
                error_message: error.message,
                device_type: Analytics.getDeviceType()
            });
        } else {
            // Track share cancellation
            Analytics.track('peer_id_share_cancelled', {
                device_type: Analytics.getDeviceType()
            });
        }
    }
}

// Setup peer event handlers
function setupPeerHandlers() {
    if (!peer) {
        console.error('Cannot setup handlers: peer is null');
        return;
    }

    peer.on('open', (id) => {
        console.log('Peer opened with ID:', id);
        elements.peerId.textContent = id;
        updateConnectionStatus('', 'Ready to connect');
        generateQRCode(id);
        initShareButton();
        updateEditButtonState();
    });

    peer.on('connection', (conn) => {
        console.log('Incoming connection from:', conn.peer);
        connections.set(conn.peer, conn);
        updateConnectionStatus('connecting', 'Incoming connection...');
        setupConnectionHandlers(conn);
    });

    peer.on('error', (error) => {
        console.error('PeerJS Error:', error);
        let errorMessage = 'Connection error';
        
        // Handle specific error types
        if (error.type === 'peer-unavailable') {
            errorMessage = 'Peer is not available or does not exist';
        } else if (error.type === 'network') {
            errorMessage = 'Network connection error';
        } else if (error.type === 'disconnected') {
            errorMessage = 'Disconnected from server';
        } else if (error.type === 'server-error') {
            errorMessage = 'Server error occurred';
        } else if (error.type === 'unavailable-id') {
            errorMessage = 'This ID is already taken. Please try another one.';
        } else if (error.type === 'browser-incompatible') {
            errorMessage = 'Your browser might not support all required features';
        } else if (error.type === 'invalid-id') {
            errorMessage = 'Invalid ID format';
        } else if (error.type === 'ssl-unavailable') {
            errorMessage = 'SSL is required for this connection';
        }
        
        updateConnectionStatus('', errorMessage);
        showNotification(errorMessage, 'error');

        // If this was during a custom ID setup, revert to auto-generated ID
        if (elements.peerIdEdit && !elements.peerIdEdit.classList.contains('hidden')) {
            cancelEditingPeerId();
            initPeerJS(); // Reinitialize with auto-generated ID
        }
    });

    peer.on('disconnected', () => {
        console.log('Peer disconnected');
        updateConnectionStatus('', 'Disconnected');
        isConnectionReady = false;
        
        // Try to reconnect
        setTimeout(() => {
            if (peer && !peer.destroyed) {
                console.log('Attempting to reconnect...');
                peer.reconnect();
            }
        }, 3000);
    });

    peer.on('close', () => {
        console.log('Peer connection closed');
        updateConnectionStatus('', 'Connection closed');
        isConnectionReady = false;
    });
}

// Initialize PeerJS
function initPeerJS() {
    try {
        console.log('Initializing PeerJS...');
        
        // Destroy existing peer if any
        if (peer) {
            console.log('Destroying existing peer connection');
            peer.destroy();
            peer = null;
        }

        // Clear existing connections
        connections.clear();

        // Create new peer with auto-generated ID
        peer = new Peer({
            debug: 2,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:global.stun.twilio.com:3478' }
                ]
            }
        });

        setupPeerHandlers();

    } catch (error) {
        console.error('PeerJS Initialization Error:', error);
        updateConnectionStatus('', 'Initialization failed');
        showNotification('Failed to initialize peer connection', 'error');
    }
}

// Setup connection event handlers
function setupConnectionHandlers(conn) {
    conn.on('open', () => {
        console.log('Connection opened with:', conn.peer);
        isConnectionReady = true;
        updateConnectionStatus('connected', `Connected to peer(s) : ${connections.size}`);
        elements.fileTransferSection.classList.remove('hidden');
        addRecentPeer(conn.peer);
        
        // Track successful connection
        Analytics.track('connection_successful', {
            peer_id_length: conn.peer.length,
            total_connections: connections.size,
            device_type: Analytics.getDeviceType(),
            connection_type: conn.type || 'data'
        });
        
        // Clear any existing timeout for this connection
        if (connectionTimeouts.has(conn.peer)) {
            clearTimeout(connectionTimeouts.get(conn.peer));
            connectionTimeouts.delete(conn.peer);
        }
        
        // Send a connection notification to the other peer
        conn.send({
            type: 'connection-notification',
            peerId: peer.id
        });
    });

    conn.on('data', async (data) => {
        try {
            switch (data.type) {
                case MESSAGE_TYPES.SIMULTANEOUS_DOWNLOAD_REQUEST:
                    await handleSimultaneousDownloadRequest(data, conn);
                    break;
                case MESSAGE_TYPES.SIMULTANEOUS_DOWNLOAD_START:
                    await requestAndDownloadBlob(data);
                    break;
                case 'connection-notification':
                    updateConnectionStatus('connected', `Connected to peer(s) : ${connections.size}`);
                    break;
                case 'keep-alive':
                    // Handle keep-alive message
                    console.log(`Keep-alive received from peer ${conn.peer}`);
                    // Send keep-alive response
                    conn.send({
                        type: 'keep-alive-response',
                        timestamp: Date.now(),
                        peerId: peer.id
                    });
                    break;
                case 'keep-alive-response':
                    // Handle keep-alive response
                    console.log(`Keep-alive response received from peer ${conn.peer}`);
                    break;
                case 'health-check':
                    // Handle health check message
                    console.log(`Health check received from peer ${conn.peer}`);
                    // Send health check response
                    conn.send({
                        type: 'health-check-response',
                        timestamp: Date.now(),
                        peerId: peer.id
                    });
                    break;
                case 'health-check-response':
                    // Handle health check response
                    console.log(`Health check response received from peer ${conn.peer}`);
                    break;
                case 'disconnect-notification':
                    // Handle disconnect notification
                    console.log(`Disconnect notification received from peer ${conn.peer}`);
                    connections.delete(conn.peer);
                    updateConnectionStatus(connections.size > 0 ? 'connected' : '', 
                        connections.size > 0 ? `Connected to peer(s) : ${connections.size}` : 'Disconnected');
                    // No notification - status change will inform the user
                    break;
                case 'file-info':
                    // Handle file info without blob
                    const fileInfo = {
                        name: data.fileName,
                        type: data.fileType,
                        size: data.fileSize,
                        id: data.fileId,
                        sharedBy: data.originalSender
                    };
                    // Add to history if not already present
                    if (!fileHistory.sent.has(data.fileId) && !fileHistory.received.has(data.fileId)) {
                        addFileToHistory(fileInfo, 'received');
                        
                        // If this is the host, forward to other peers
                        if (connections.size > 1) {
                            await forwardFileInfoToPeers(fileInfo, data.fileId);
                        }
                    }
                    break;
                case 'file-header':
                    await handleFileHeader(data);
                    break;
                case 'file-chunk':
                    await handleFileChunk(data);
                    break;
                case 'file-complete':
                    await handleFileComplete(data);
                    break;
                case 'blob-request':
                    // Handle direct blob request
                    await handleBlobRequest(data, conn);
                    break;
                case 'blob-request-forwarded':
                    // Handle forwarded blob request (host only)
                    await handleForwardedBlobRequest(data, conn);
                    break;
                case 'blob-error':
                    showNotification(`Failed to download file: ${data.error}`, 'error');
                    elements.transferProgress.classList.add('hidden');
                    updateTransferInfo('');
                    break;
                default:
                    console.error('Unknown data type:', data.type);
            }
        } catch (error) {
            console.error('Data handling error:', error);
            showNotification('Error processing received data', 'error');
        }
    });

    conn.on('close', () => {
        console.log('Connection closed with:', conn.peer);
        connections.delete(conn.peer);
        
        // Clear timeout for this connection
        if (connectionTimeouts.has(conn.peer)) {
            clearTimeout(connectionTimeouts.get(conn.peer));
            connectionTimeouts.delete(conn.peer);
        }
        
        updateConnectionStatus(connections.size > 0 ? 'connected' : '', 
            connections.size > 0 ? `Connected to peer(s) : ${connections.size}` : 'Disconnected');
        if (connections.size === 0) {
            // No notification - status change will inform the user
        } else {
            // No notification - status change will inform the user
        }
    });

    conn.on('error', (error) => {
        console.error('Connection Error:', error);
        
        // Don't immediately show error notification - it might be temporary
        // Only attempt reconnection if it persists for a while
        if (!connectionTimeouts.has(conn.peer)) {
            const timeout = setTimeout(() => {
                console.log(`⚠️ Connection error persisted for ${conn.peer}, attempting reconnection...`);
                updateConnectionStatus('', 'Connection error');
                
                // Attempt reconnection
                console.log(`Attempting to reconnect to ${conn.peer} after error...`);
                reconnectToPeer(conn.peer);
                connectionTimeouts.delete(conn.peer);
            }, 8000); // Wait 8 seconds before attempting reconnection
            
            connectionTimeouts.set(conn.peer, timeout);
        }
    });
}

// Helper function to generate unique file ID
function generateFileId(file) {
    return `${file.name}-${file.size}`;
}

// Handle file header
async function handleFileHeader(data) {
    console.log('Received file header:', data);
    fileChunks[data.fileId] = {
        chunks: [],
        fileName: data.fileName,
        fileType: data.fileType,
        fileSize: data.fileSize,
        receivedSize: 0,
        originalSender: data.originalSender
    };
    elements.transferProgress.classList.add('hidden'); // Always hide
    updateProgress(0);
    updateTransferInfo(`Receiving ${data.fileName} from ${data.originalSender}...`);
}

// Handle file chunk
async function handleFileChunk(data) {
    const fileData = fileChunks[data.fileId];
    if (!fileData) return;

    fileData.chunks.push(data.data);
    fileData.receivedSize += data.data.byteLength;
    
    // Update progress more smoothly (update every 1% change)
    const currentProgress = (fileData.receivedSize / fileData.fileSize) * 100;
    if (!fileData.lastProgressUpdate || currentProgress - fileData.lastProgressUpdate >= 1) {
        updateProgress(currentProgress, data.fileId);
        fileData.lastProgressUpdate = currentProgress;
    }
}

// Handle file completion
async function handleFileComplete(data) {
    const fileData = fileChunks[data.fileId];
    if (!fileData) return;

    try {
        // Combine chunks into blob if this is a blob transfer
        if (fileData.chunks.length > 0) {
            const blob = new Blob(fileData.chunks, { type: fileData.fileType });
            
            // Verify file size
            if (blob.size !== fileData.fileSize) {
                throw new Error('Received file size does not match expected size');
            }

            // Create download URL and trigger download
            downloadBlob(blob, fileData.fileName, data.fileId);
            showNotification(`Downloaded ${fileData.fileName}`, 'success');

            // Update UI to show completed state
            const listItem = document.querySelector(`[data-file-id="${data.fileId}"]`);
            if (listItem) {
                listItem.classList.add('download-completed');
                const downloadButton = listItem.querySelector('.icon-button');
                if (downloadButton) {
                    downloadButton.classList.add('download-completed');
                    downloadButton.innerHTML = '<span class="material-icons">open_in_new</span>';
                    downloadButton.title = 'Open file';
                    
                    // Store the blob URL for opening the file
                    const blobUrl = URL.createObjectURL(blob);
                    downloadButton.onclick = () => {
                        window.open(blobUrl, '_blank');
                    };
                }
            }
        }

        // Create file info object
        const fileInfo = {
            name: fileData.fileName,
            type: fileData.fileType,
            size: fileData.fileSize,
            id: data.fileId,
            sharedBy: fileData.originalSender
        };

        // Add to history if this is a new file info
        if (!fileHistory.sent.has(data.fileId) && !fileHistory.received.has(data.fileId)) {
            addFileToHistory(fileInfo, 'received');

            // If this is the host peer, forward the file info to other connected peers
            if (connections.size > 1) {
                console.log('Forwarding file info to other peers as host');
                await forwardFileInfoToPeers(fileInfo, data.fileId);
            }
        }

    } catch (error) {
        console.error('Error handling file completion:', error);
        showNotification('Error processing file: ' + error.message, 'error');
    } finally {
        delete fileChunks[data.fileId];
        elements.transferProgress.classList.add('hidden'); // Ensure it's hidden
        updateProgress(0);
        updateTransferInfo('');
    }
}

// Forward file info to other connected peers
async function forwardFileInfoToPeers(fileInfo, fileId) {
    // Create a standardized file info object that includes direct download info
    const fileInfoToSend = {
        type: 'file-info',
        fileId: fileId,
        fileName: fileInfo.name,
        fileType: fileInfo.type,
        fileSize: fileInfo.size,
        originalSender: fileInfo.sharedBy || peer.id,
        timestamp: Date.now(),
        directDownload: true // Indicate this file supports direct download
    };

    // Send to all connected peers except the original sender
    for (const [peerId, conn] of connections) {
        if (peerId !== fileInfo.sharedBy && conn && conn.open) {
            try {
                console.log(`Forwarding file info to peer: ${peerId}`);
                conn.send(fileInfoToSend);
            } catch (error) {
                console.error(`Error forwarding file info to peer ${peerId}:`, error);
            }
        }
    }
}

// Send file to a specific peer
async function sendFileToPeer(file, conn, fileId, fileBlob) {
    try {
        if (!conn.open) {
            throw new Error('Connection is not open');
        }

        // Store the blob for later use
        sentFileBlobs.set(fileId, fileBlob);

        // Send file info only
        conn.send({
            type: 'file-info',
            fileId: fileId,
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            originalSender: peer.id
        });

        console.log(`File info sent successfully to peer ${conn.peer}`);
    } catch (error) {
        console.error(`Error sending file info to peer ${conn.peer}:`, error);
        throw new Error(`Failed to send to peer ${conn.peer}: ${error.message}`);
    }
}

// Handle blob request
async function handleBlobRequest(data, conn) {
    const { fileId, forwardTo } = data;
    console.log('Received blob request for file:', fileId);

    // Check if we have the blob
    const blob = sentFileBlobs.get(fileId);
    if (!blob) {
        console.error('Blob not found for file:', fileId);
        conn.send({
            type: 'blob-error',
            fileId: fileId,
            error: 'File not available'
        });
        return;
    }

    try {
        // Convert blob to array buffer
        const buffer = await blob.arrayBuffer();
        let offset = 0;
        let lastProgressUpdate = 0;

        // Send file header
        conn.send({
            type: 'file-header',
            fileId: fileId,
            fileName: data.fileName,
            fileType: blob.type,
            fileSize: blob.size,
            originalSender: peer.id,
            timestamp: Date.now()
        });

        // Send chunks
        while (offset < blob.size) {
            if (!conn.open) {
                throw new Error('Connection lost during transfer');
            }

            const chunk = buffer.slice(offset, offset + CHUNK_SIZE);
            conn.send({
                type: 'file-chunk',
                fileId: fileId,
                data: chunk,
                offset: offset,
                total: blob.size
            });

            offset += chunk.byteLength;

            // Update progress
            const currentProgress = (offset / blob.size) * 100;
            if (currentProgress - lastProgressUpdate >= 1) {
                updateProgress(currentProgress, fileId);
                lastProgressUpdate = currentProgress;
            }
        }

        // Send completion message
        conn.send({
            type: 'file-complete',
            fileId: fileId,
            fileName: data.fileName,
            fileType: blob.type,
            fileSize: blob.size,
            timestamp: Date.now()
        });

        console.log(`File sent successfully to peer ${conn.peer}`);
    } catch (error) {
        console.error(`Error sending file to peer:`, error);
        conn.send({
            type: 'blob-error',
            fileId: fileId,
            error: error.message
        });
    }
}

// Function to request and download a blob
async function requestAndDownloadBlob(fileInfo) {
    try {
        // Always try to connect to original sender directly
        let conn = connections.get(fileInfo.sharedBy);
        
        if (!conn || !conn.open) {
            // If no direct connection exists, establish one
            console.log('No direct connection to sender, establishing connection...');
            conn = peer.connect(fileInfo.sharedBy, {
                reliable: true
            });
            
            // Wait for connection to open
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Connection timeout'));
                }, 10000); // 10 second timeout

                conn.on('open', () => {
                    clearTimeout(timeout);
                    connections.set(fileInfo.sharedBy, conn);
                    setupConnectionHandlers(conn);
                    resolve();
                });

                conn.on('error', (err) => {
                    clearTimeout(timeout);
                    reject(err);
                });
            });
        }

        // Now we should have a direct connection to the sender
        elements.transferProgress.classList.add('hidden'); // Hide the progress bar
        updateProgress(0, fileInfo.id);
        updateTransferInfo('');

        // Request the file directly
        conn.send({
            type: 'blob-request',
            fileId: fileInfo.id,
            fileName: fileInfo.name,
            directRequest: true
        });

    } catch (error) {
        console.error('Error requesting file:', error);
        showNotification(`Failed to download file: ${error.message}`, 'error');
        elements.transferProgress.classList.add('hidden');
        updateTransferInfo('');
    }
}

// Handle forwarded blob request (host only)
async function handleForwardedBlobRequest(data, fromConn) {
    console.log('Handling forwarded blob request:', data);
    
    // Find connection to original sender
    const originalSenderConn = connections.get(data.originalSender);
    if (!originalSenderConn || !originalSenderConn.open) {
        fromConn.send({
            type: 'blob-error',
            fileId: data.fileId,
            error: 'Original sender not connected to host'
        });
        return;
    }

    // Request blob from original sender with forwarding info
    originalSenderConn.send({
        type: 'blob-request',
        fileId: data.fileId,
        fileName: data.fileName,
        forwardTo: data.requesterId
    });
}

// Update transfer info display
function updateTransferInfo(message) {
    if (elements.transferInfo) {
        elements.transferInfo.textContent = message;
    }
}

// Add file to history
function addFileToHistory(fileInfo, type) {
    const fileId = fileInfo.id || generateFileId(fileInfo);
    
    // Determine the correct type based on who shared the file
    const actualType = fileInfo.sharedBy === peer.id ? 'sent' : 'received';
    
    // Remove from both history sets to prevent duplicates
    fileHistory.sent.delete(fileId);
    fileHistory.received.delete(fileId);
    
    // Add to the correct history set
    fileHistory[actualType].add(fileId);
    
    // Remove existing entries from UI if any
    const sentList = elements.sentFilesList;
    const receivedList = elements.receivedFilesList;
    
    // Remove from sent list if exists
    const existingInSent = sentList.querySelector(`[data-file-id="${fileId}"]`);
    if (existingInSent) {
        existingInSent.remove();
    }
    
    // Remove from received list if exists
    const existingInReceived = receivedList.querySelector(`[data-file-id="${fileId}"]`);
    if (existingInReceived) {
        existingInReceived.remove();
    }
    
    // Update UI with the correct list
    const listElement = actualType === 'sent' ? elements.sentFilesList : elements.receivedFilesList;
    updateFilesList(listElement, fileInfo, actualType);

    // Only broadcast updates for files we send originally
    if (fileInfo.sharedBy === peer.id) {
        broadcastFileUpdate(fileInfo);
    }
}

// Broadcast file update to all peers
function broadcastFileUpdate(fileInfo) {
    const updateData = {
        type: 'file-update',
        fileInfo: {
            id: fileInfo.id,
            name: fileInfo.name,
            type: fileInfo.type,
            size: fileInfo.size,
            sharedBy: fileInfo.sharedBy
        }
    };

    for (const conn of connections.values()) {
        if (conn.open) {
            conn.send(updateData);
        }
    }
}

// Process file queue
async function processFileQueue() {
    if (isProcessingQueue || fileQueue.length === 0) return;
    
    isProcessingQueue = true;
    updateTransferInfo(`Processing queue: ${fileQueue.length} file(s) remaining`);
    
    while (fileQueue.length > 0) {
        const file = fileQueue.shift();
        try {
            await sendFile(file);
            // Small delay between files to prevent overwhelming the connection
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
            console.error('Error processing file from queue:', error);
            showNotification(`Failed to send ${file.name}: ${error.message}`, 'error');
        }
    }
    
    isProcessingQueue = false;
    updateTransferInfo('');
}

// Modify sendFile function to work with queue
async function sendFile(file) {
    if (connections.size === 0) {
        showNotification('Please connect to at least one peer first', 'error');
        return;
    }

    if (transferInProgress) {
        // Add to queue instead of showing warning
        fileQueue.push(file);
        showNotification(`${file.name} added to queue`, 'info');
        return;
    }

    try {
        transferInProgress = true;
        elements.transferProgress.classList.add('hidden'); // Always hide
        updateProgress(0);
        updateTransferInfo(`Sending ${file.name}...`);

        // Generate a unique file ID that will be same for all recipients
        const fileId = generateFileId(file);
        
        // Create file blob once for the sender
        const fileBlob = new Blob([await file.arrayBuffer()], { type: file.type });
        
        // Add to sender's history first
        const fileInfo = {
            name: file.name,
            type: file.type,
            size: file.size,
            id: fileId,
            blob: fileBlob,
            sharedBy: peer.id
        };
        addFileToHistory(fileInfo, 'sent');

        // Send to all connected peers
        const sendPromises = [];
        let successCount = 0;
        const errors = [];

        for (const [peerId, conn] of connections) {
            if (conn && conn.open) {
                try {
                    await sendFileToPeer(file, conn, fileId, fileBlob);
                    successCount++;
                } catch (error) {
                    errors.push(error.message);
                }
            }
        }

        if (successCount > 0) {
            showNotification(`${file.name} sent successfully`, 'success');
            
            // Track successful file send
            Analytics.track('file_sent_successfully', {
                file_size: file.size,
                file_type: Analytics.getFileExtension(file.name),
                file_size_category: Analytics.getFileSizeCategory(file.size),
                recipients_count: successCount,
                total_connected_peers: connections.size,
                device_type: Analytics.getDeviceType()
            });
        } else {
            throw new Error('Failed to send file to any peers: ' + errors.join(', '));
        }
    } catch (error) {
        console.error('File send error:', error);
        showNotification(error.message, 'error');
        
        // Track file send failure
        Analytics.track('file_send_failed', {
            file_size: file.size,
            file_type: Analytics.getFileExtension(file.name),
            file_size_category: Analytics.getFileSizeCategory(file.size),
            error_message: error.message,
            connected_peers: connections.size,
            device_type: Analytics.getDeviceType()
        });
        
        throw error; // Propagate error for queue processing
    } finally {
        transferInProgress = false;
        elements.transferProgress.classList.add('hidden'); // Always hide
        updateProgress(0);
        // Process next file in queue if any
        processFileQueue();
    }
}

// --- Patch updateProgress to show notification ---
// const originalUpdateProgress = updateProgress;
// updateProgress = function(progress) {
//     showProgressNotification(progress);
//     originalUpdateProgress(progress);
//     if (progress >= 100) {
//         setTimeout(clearProgressNotification, 1000);
//     }
// };

// Update progress bar
function updateProgress(percent) {
    const progress = Math.min(Math.floor(percent), 100); // Ensure integer value and cap at 100
    elements.progress.style.width = `${progress}%`;
    elements.transferInfo.style.display = 'block';
    // Only hide transfer info when transfer is complete and progress is 100%
    if (progress === 100) {
        setTimeout(() => {
            elements.transferInfo.style.display = 'none';
        }, 1000); // Keep the 100% visible briefly
    }
}

// UI Functions
function addFileToList(name, url, size) {
    const li = document.createElement('li');
    const nameSpan = document.createElement('span');
    nameSpan.textContent = `${name} (${formatFileSize(size)})`;
    
    const downloadBtn = document.createElement('a');
    downloadBtn.href = url;
    downloadBtn.download = name;
    downloadBtn.className = 'button';
    downloadBtn.textContent = 'Download';
    
    // Add click handler to handle blob URL cleanup
    downloadBtn.addEventListener('click', () => {
        setTimeout(() => {
            URL.revokeObjectURL(url);
        }, 1000);
    });
    
    li.appendChild(nameSpan);
    li.appendChild(downloadBtn);
    elements.fileList.appendChild(li);
    
    if (elements.receivedFiles) {
        elements.receivedFiles.classList.remove('hidden');
    }
}

function formatFileSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message.charAt(0).toUpperCase() + message.slice(1);  // Ensure sentence case
    
    elements.notifications.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 5000);
}

function resetConnection() {
    if (connections.size > 0) {
        connections.forEach((conn, peerId) => {
            if (conn && conn.open) {
                conn.close();
            }
        });
        connections.clear();
    }
    
    // Clear all connection timeouts
    connectionTimeouts.forEach(timeout => clearTimeout(timeout));
    connectionTimeouts.clear();
    
    isConnectionReady = false;
    transferInProgress = false;
    fileQueue = []; // Clear the file queue
    isProcessingQueue = false;
    elements.fileTransferSection.classList.add('hidden');
    elements.transferProgress.classList.add('hidden');
    elements.progress.style.width = '0%';
    elements.transferInfo.style.display = 'none';
    updateConnectionStatus('', 'Ready to connect');
}

// Event Listeners
elements.copyId.addEventListener('click', () => {
    const peerId = elements.peerId.textContent;
    
    // Track peer ID copy event
    Analytics.track('peer_id_copied', {
        peer_id_length: peerId.length,
        device_type: Analytics.getDeviceType()
    });
    
    navigator.clipboard.writeText(peerId)
        .then(() => {
            showNotification('Peer ID copied to clipboard');
            // Track successful copy
            Analytics.track('peer_id_copy_success', {
                peer_id_length: peerId.length
            });
        })
        .catch(err => {
            showNotification('Failed to copy Peer ID', 'error');
            // Track copy failure
            Analytics.track('peer_id_copy_failed', {
                error: err.message
            });
        });
});

elements.connectButton.addEventListener('click', () => {
    const remotePeerIdValue = elements.remotePeerId.value.trim();
    
    // Track connect button click
    Analytics.track('connect_button_clicked', {
        has_peer_id: !!remotePeerIdValue,
        peer_id_length: remotePeerIdValue.length,
        current_connections: connections.size
    });
    
    if (!remotePeerIdValue) {
        showNotification('Please enter a Peer ID', 'error');
        Analytics.track('connection_failed_no_peer_id');
        return;
    }

    if (connections.has(remotePeerIdValue)) {
        // showNotification('Already connected to this peer', 'warning'); // Suppressed as per user request
        Analytics.track('connection_already_exists', {
            target_peer_id_length: remotePeerIdValue.length
        });
        return;
    }

    try {
        console.log('Attempting to connect to:', remotePeerIdValue);
        updateConnectionStatus('connecting', 'Connecting...');
        
        // Track connection attempt
        Analytics.track('connection_attempted', {
            target_peer_id_length: remotePeerIdValue.length,
            current_connections: connections.size,
            device_type: Analytics.getDeviceType()
        });
        
        const newConnection = peer.connect(remotePeerIdValue, {
            reliable: true
        });
        connections.set(remotePeerIdValue, newConnection);
        setupConnectionHandlers(newConnection);
    } catch (error) {
        console.error('Connection attempt error:', error);
        updateConnectionStatus('', 'Connection failed');
        
        // Track connection failure
        Analytics.track('connection_attempt_failed', {
            error: error.message,
            target_peer_id_length: remotePeerIdValue.length
        });
    }
});

// Add Enter key support for connecting to peer
elements.remotePeerId.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        elements.connectButton.click();
        if (elements.recentPeers) {
            elements.recentPeers.classList.add('hidden');
        }
        elements.remotePeerId.blur(); // Dismiss keyboard
    }
});

// Add keydown event support for connecting to peer (for mobile compatibility)
elements.remotePeerId.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        elements.connectButton.click();
        if (elements.recentPeers) {
            elements.recentPeers.classList.add('hidden');
        }
        elements.remotePeerId.blur(); // Dismiss keyboard
    }
});

elements.dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    elements.dropZone.classList.add('drag-over');
});

elements.dropZone.addEventListener('dragleave', () => {
    elements.dropZone.classList.remove('drag-over');
});

elements.dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    elements.dropZone.classList.remove('drag-over');
    
    if (connections.size > 0) {
        const files = e.dataTransfer.files;
        if (files.length > 1) {
            showNotification(`Processing ${files.length} files`, 'info');
        }
        Array.from(files).forEach(file => {
            fileQueue.push(file);
        });
        processFileQueue();
    } else {
        showNotification('Please connect to at least one peer first', 'error');
    }
});

// Add click handler for the drop zone
elements.dropZone.addEventListener('click', () => {
    // Track file upload icon click
    Analytics.track('file_upload_icon_clicked', {
        connected_peers: connections.size,
        device_type: Analytics.getDeviceType()
    });
    
    if (connections.size > 0) {
        elements.fileInput.click();
    } else {
        showNotification('Please connect to at least one peer first', 'error');
        Analytics.track('file_upload_blocked_no_connection');
    }
});

// Update file input change handler
elements.fileInput.addEventListener('change', (e) => {
    if (connections.size > 0) {
        const files = e.target.files;
        if (files.length > 0) {
            // Track file selection
            const fileStats = Array.from(files).map(file => ({
                size: file.size,
                type: Analytics.getFileExtension(file.name),
                sizeCategory: Analytics.getFileSizeCategory(file.size)
            }));
            
            Analytics.track('files_selected_for_upload', {
                file_count: files.length,
                total_size: fileStats.reduce((sum, f) => sum + f.size, 0),
                file_types: [...new Set(fileStats.map(f => f.type))].join(','),
                size_categories: [...new Set(fileStats.map(f => f.sizeCategory))].join(','),
                connected_peers: connections.size
            });
            
            if (files.length > 1) {
                showNotification(`Processing ${files.length} files`, 'info');
            }
            Array.from(files).forEach(file => {
                fileQueue.push(file);
            });
            processFileQueue();
        }
        // Reset the input so the same file can be selected again
        e.target.value = '';
    } else {
        showNotification('Please connect to at least one peer first', 'error');
        Analytics.track('file_upload_blocked_no_connection');
    }
});

// Initialize the application
function init() {
    if (!checkBrowserSupport()) {
        return;
    }

    initPeerJS();
    initIndexedDB();
    loadRecentPeers();
    checkUrlForPeerId(); // Check URL for peer ID on load
    initConnectionKeepAlive(); // Initialize connection keep-alive system
    initPeerIdEditing(); // Initialize peer ID editing
    initSocialMediaToggle(); // Initialize social media toggle
    elements.transferProgress.classList.add('hidden'); // Always hide transfer bar
}

// Social Media Toggle Functionality
function initSocialMediaToggle() {
    console.log('Initializing social media toggle...');
    console.log('socialToggle element:', elements.socialToggle);
    console.log('socialIcons element:', elements.socialIcons);
    
    if (elements.socialToggle && elements.socialIcons) {
        console.log('Social media elements found, adding event listeners...');
        
        elements.socialToggle.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('Social toggle clicked!');
            
            const isOpening = !elements.socialIcons.classList.contains('show');
            
            // Track social media toggle click
            Analytics.track('social_media_toggle_clicked', {
                action: isOpening ? 'open' : 'close',
                device_type: Analytics.getDeviceType()
            });
            
            elements.socialIcons.classList.toggle('show');
            console.log('Social icons show class:', elements.socialIcons.classList.contains('show'));
        });

        // Close social media menu when clicking outside
                                document.addEventListener('click', function(event) {
                            if (!elements.socialToggle.contains(event.target) && !elements.socialIcons.contains(event.target)) {
                                elements.socialIcons.classList.remove('show');
                            }
                        });
        
        // Add analytics tracking for individual social media button clicks
        const socialIconLinks = elements.socialIcons.querySelectorAll('a.social-icon');
        socialIconLinks.forEach(link => {
            link.addEventListener('click', function(e) {
                const socialType = this.classList.value.replace('social-icon', '').trim() || 'unknown';
                const linkTitle = this.getAttribute('title') || socialType;
                
                // Track social media button click
                Analytics.track('social_media_button_clicked', {
                    social_type: socialType,
                    social_title: linkTitle,
                    device_type: Analytics.getDeviceType(),
                    url: this.href
                });
            });
        });
        
        console.log('Social media toggle initialized successfully!');
    } else {
        console.error('Social media elements not found!');
    }
}

// Add CSS classes for notification styling
const style = document.createElement('style');
style.textContent = `
    .notification {
        display: flex;
        align-items: center;
        gap: 8px;
        animation: slideIn 0.3s ease-out;
        transition: opacity 0.3s ease-out;
    }
    
    .notification.fade-out {
        opacity: 0;
    }
    
    .notification-icon {
        font-size: 1.2em;
    }
    
    .notification.info {
        background-color: #e0f2fe;
        color: #0369a1;
    }
    
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
`;
document.head.appendChild(style);

// Add function to update connection status
function updateConnectionStatus(status, message) {
    elements.statusDot.className = 'status-dot ' + (status || '');
    elements.statusText.textContent = message.charAt(0).toUpperCase() + message.slice(1);  // Ensure sentence case
    
    // Update title to show number of connections
    if (connections && connections.size > 0) {
        document.title = `(${connections.size}) One-Host`;
    } else {
        document.title = 'One-Host';
    }
    updateEditButtonState(); // Add this line
}

// Update files list display
function updateFilesList(listElement, fileInfo, type) {
    console.log('Updating files list:', { type, fileInfo });
    
    // Check if file already exists in this list
    const existingFile = listElement.querySelector(`[data-file-id="${fileInfo.id}"]`);
    if (existingFile) {
        console.log('File already exists in list, updating...');
        existingFile.remove();
    }

    const li = document.createElement('li');
    li.className = 'file-item';
    li.setAttribute('data-file-id', fileInfo.id);
    
    const icon = document.createElement('span');
    icon.className = 'material-icons';
    icon.textContent = getFileIcon(fileInfo.type);
    
    const info = document.createElement('div');
    info.className = 'file-info';
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'file-name';
    nameSpan.textContent = fileInfo.name;
    
    const sizeSpan = document.createElement('span');
    sizeSpan.className = 'file-size';
    sizeSpan.textContent = formatFileSize(fileInfo.size);

    const sharedBySpan = document.createElement('span');
    sharedBySpan.className = 'shared-by';
    sharedBySpan.textContent = type === 'sent' ? 
        'Sent to connected peers' : 
        `Received from peer ${fileInfo.sharedBy || 'Unknown'}`;
    
    info.appendChild(nameSpan);
    info.appendChild(sizeSpan);
    info.appendChild(sharedBySpan);
    
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'icon-button';
    downloadBtn.title = 'Download file';
    downloadBtn.innerHTML = '<span class="material-icons">download</span>';
    downloadBtn.onclick = async () => {
        try {
            // Track download button click
            Analytics.track('file_download_clicked', {
                file_size: fileInfo.size,
                file_type: Analytics.getFileExtension(fileInfo.name),
                file_size_category: Analytics.getFileSizeCategory(fileInfo.size),
                download_type: type === 'sent' ? 'local_blob' : 'remote_request',
                device_type: Analytics.getDeviceType()
            });
            
            if (type === 'sent' && sentFileBlobs.has(fileInfo.id)) {
                // For sent files, we have the blob locally
                const blob = sentFileBlobs.get(fileInfo.id);
                downloadBlob(blob, fileInfo.name, fileInfo.id);
            } else {
                // For received files, request the blob from the original sender
                await requestAndDownloadBlob(fileInfo);
            }
        } catch (error) {
            console.error('Error downloading file:', error);
            showNotification('Failed to download file: ' + error.message, 'error');
            
            // Track download failure
            Analytics.track('file_download_failed', {
                file_size: fileInfo.size,
                file_type: Analytics.getFileExtension(fileInfo.name),
                error_message: error.message,
                download_type: type === 'sent' ? 'local_blob' : 'remote_request'
            });
        }
    };
    
    li.appendChild(icon);
    li.appendChild(info);
    li.appendChild(downloadBtn);
    
    // Add to the beginning of the list for newest first
    if (listElement.firstChild) {
        listElement.insertBefore(li, listElement.firstChild);
    } else {
        listElement.appendChild(li);
    }
    
    // Scroll the new received file into view
    if (type === 'received') {
        setTimeout(() => {
            li.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
    }
    
    console.log('File list updated successfully');
}

// Add function to get appropriate file icon
function getFileIcon(mimeType) {
    if (!mimeType) return 'insert_drive_file';
    
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'movie';
    if (mimeType.startsWith('audio/')) return 'audiotrack';
    if (mimeType.includes('pdf')) return 'picture_as_pdf';
    if (mimeType.includes('word') || mimeType.includes('document')) return 'description';
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return 'table_chart';
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return 'slideshow';
    if (mimeType.includes('text/')) return 'text_snippet';
    if (mimeType.includes('zip') || mimeType.includes('archive')) return 'folder_zip';
    
    return 'insert_drive_file';
}

// Add event listeners for recent peers
elements.remotePeerId.addEventListener('focus', () => {
    if (recentPeers.length > 0) {
        elements.recentPeers.classList.remove('hidden');
    }
});

elements.remotePeerId.addEventListener('blur', (e) => {
    // Delay hiding to allow for click events on the list
    setTimeout(() => {
        elements.recentPeers.classList.add('hidden');
    }, 200);
});

elements.clearPeers.addEventListener('click', () => {
    recentPeers = [];
    saveRecentPeers();
    updateRecentPeersList();
    elements.recentPeers.classList.add('hidden');
});

// Initialize connection keep-alive system
function initConnectionKeepAlive() {
    // Start keep-alive interval
    keepAliveInterval = setInterval(() => {
        if (connections.size > 0 && isPageVisible) {
            sendKeepAlive();
        }
    }, KEEP_ALIVE_INTERVAL);

    // Handle page visibility changes
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Handle page focus/blur events
    window.addEventListener('focus', handlePageFocus);
    window.addEventListener('blur', handlePageBlur);
    
    // Handle beforeunload event
    window.addEventListener('beforeunload', handleBeforeUnload);
}

// Handle page visibility changes with improved mobile handling
function handleVisibilityChange() {
    isPageVisible = !document.hidden;
    
    if (isPageVisible) {
        console.log('📱 Page became visible, performing gentle connection check...');
        // Don't immediately check connections - give them time to stabilize
        setTimeout(() => {
            checkConnections();
        }, 1000); // Wait 1 second for connections to stabilize
    } else {
        console.log('📱 Page became hidden, maintaining connections...');
        sendKeepAlive();
    }
}

// Handle page focus with improved mobile handling
function handlePageFocus() {
    console.log('📱 Page focused, performing gentle connection check...');
    // Don't immediately check connections - give them time to stabilize
    setTimeout(() => {
        checkConnections();
    }, 1500); // Wait 1.5 seconds for connections to stabilize
}

// Handle page blur
function handlePageBlur() {
    console.log('Page blurred, maintaining connections...');
    sendKeepAlive();
}

// Handle beforeunload
function handleBeforeUnload(event) {
    if (connections.size > 0) {
        sendDisconnectNotification();
    }
}

// Send keep-alive messages to all connected peers
function sendKeepAlive() {
    const keepAliveData = {
        type: 'keep-alive',
        timestamp: Date.now(),
        peerId: peer.id
    };

    for (const [peerId, conn] of connections) {
        if (conn && conn.open) {
            try {
                conn.send(keepAliveData);
                console.log(`Keep-alive sent to peer ${peerId}`);
            } catch (error) {
                console.error(`Failed to send keep-alive to peer ${peerId}:`, error);
            }
        }
    }
}

// Send disconnect notification to all peers
function sendDisconnectNotification() {
    const disconnectData = {
        type: 'disconnect-notification',
        peerId: peer.id,
        timestamp: Date.now()
    };

    for (const [peerId, conn] of connections) {
        if (conn && conn.open) {
            try {
                conn.send(disconnectData);
            } catch (error) {
                console.error(`Failed to send disconnect notification to peer ${peerId}:`, error);
            }
        }
    }
}

// Check and restore connections with improved mobile handling
function checkConnections() {
    console.log('🔍 Checking connection health...');
    
    for (const [peerId, conn] of connections) {
        if (conn) {
            // More robust connection health check
            const isHealthy = checkConnectionHealth(conn, peerId);
            
            if (!isHealthy) {
                console.log(`⚠️ Connection to ${peerId} appears unhealthy, attempting to restore...`);
                // Don't immediately reconnect - try a gentle health check first
                attemptConnectionRestore(conn, peerId);
            } else {
                console.log(`✅ Connection to ${peerId} is healthy`);
            }
        }
    }
}

// Improved connection health check
function checkConnectionHealth(conn, peerId) {
    try {
        // Check if connection object exists and has basic properties
        if (!conn || typeof conn !== 'object') {
            return false;
        }
        
        // Check if connection is marked as open
        if (conn.open === false) {
            return false;
        }
        
        // Check if connection has a peer property
        if (!conn.peer || conn.peer !== peerId) {
            return false;
        }
        
        // Try to send a gentle ping to test connectivity
        // Don't throw error if it fails - just return false
        try {
            // Send a lightweight health check
            conn.send({
                type: 'health-check',
                timestamp: Date.now(),
                peerId: peer.id
            });
            return true;
        } catch (error) {
            console.log(`Health check failed for ${peerId}:`, error.message);
            return false;
        }
        
    } catch (error) {
        console.log(`Health check error for ${peerId}:`, error.message);
        return false;
    }
}

// Gentle connection restoration attempt
function attemptConnectionRestore(conn, peerId) {
    // Don't immediately reconnect - give the connection a chance to recover
    if (!connectionTimeouts.has(peerId)) {
        const timeout = setTimeout(() => {
            console.log(`🔄 Attempting gentle connection restoration for ${peerId}...`);
            
            // Try to send a keep-alive first
            try {
                conn.send({
                    type: 'keep-alive',
                    timestamp: Date.now(),
                    peerId: peer.id
                });
                console.log(`✅ Keep-alive sent successfully to ${peerId} - connection may be healthy`);
            } catch (error) {
                console.log(`❌ Keep-alive failed for ${peerId}, attempting reconnection...`);
                reconnectToPeer(peerId);
            }
            
            connectionTimeouts.delete(peerId);
        }, 2000); // Wait 2 seconds before attempting restoration
        
        connectionTimeouts.set(peerId, timeout);
    }
}

// Reconnect to a specific peer
function reconnectToPeer(peerId) {
    try {
        console.log(`Attempting to reconnect to peer: ${peerId}`);
        const newConnection = peer.connect(peerId, {
            reliable: true
        });
        connections.set(peerId, newConnection);
        setupConnectionHandlers(newConnection);
    } catch (error) {
        console.error(`Failed to reconnect to peer ${peerId}:`, error);
        connections.delete(peerId);
    }
}

// Function to download a blob
function downloadBlob(blob, fileName, fileId) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Track successful download
    Analytics.track('file_downloaded_successfully', {
        file_size: blob.size,
        file_type: Analytics.getFileExtension(fileName),
        file_size_category: Analytics.getFileSizeCategory(blob.size),
        device_type: Analytics.getDeviceType()
    });

    // If fileId is provided, update the UI
    if (fileId) {
        const listItem = document.querySelector(`[data-file-id="${fileId}"]`);
        if (listItem) {
            listItem.classList.add('download-completed');
            const downloadButton = listItem.querySelector('.icon-button');
            if (downloadButton) {
                downloadButton.classList.add('download-completed');
                downloadButton.innerHTML = '<span class="material-icons">open_in_new</span>';
                downloadButton.title = 'Open file';
                
                // Store the blob URL for opening the file
                const openUrl = URL.createObjectURL(blob);
                downloadButton.onclick = () => {
                    // Track file open click
                    Analytics.track('file_open_clicked', {
                        file_size: blob.size,
                        file_type: Analytics.getFileExtension(fileName),
                        device_type: Analytics.getDeviceType()
                    });
                    window.open(openUrl, '_blank');
                };
            }
        }
    }

    // Cleanup the download URL
    setTimeout(() => URL.revokeObjectURL(url), 100);
}

// Function to handle simultaneous download request
async function handleSimultaneousDownloadRequest(data, conn) {
    console.log('Received simultaneous download request:', data);
    const { fileId } = data;
    
    // Check if we have the blob
    const blob = sentFileBlobs.get(fileId);
    if (!blob) {
        console.error('Blob not found for file:', fileId);
        conn.send({
            type: MESSAGE_TYPES.BLOB_ERROR,
            fileId: fileId,
            error: 'File not available'
        });
        return;
    }

    // Send ready signal
    conn.send({
        type: MESSAGE_TYPES.SIMULTANEOUS_DOWNLOAD_READY,
        fileId: fileId,
        fileSize: blob.size
    });
}

// Function to initiate simultaneous download
async function initiateSimultaneousDownload(fileInfo) {
    const downloadingPeers = new Set();
    const readyPeers = new Set();
    let downloadStarted = false;

    // Function to start download for all ready peers
    const startDownloadForAll = () => {
        if (downloadStarted) return;
        downloadStarted = true;
        
        console.log('Starting simultaneous download for all ready peers');
        for (const [peerId, conn] of connections) {
            if (readyPeers.has(peerId)) {
                conn.send({
                    type: MESSAGE_TYPES.SIMULTANEOUS_DOWNLOAD_START,
                    fileId: fileInfo.fileId
                });
            }
        }
    };

    // Request download from original sender for all connected peers
    for (const [peerId, conn] of connections) {
        if (conn && conn.open && peerId === fileInfo.originalSender) {
            downloadingPeers.add(peerId);
            conn.send({
                type: MESSAGE_TYPES.SIMULTANEOUS_DOWNLOAD_REQUEST,
                fileId: fileInfo.fileId,
                fileName: fileInfo.fileName
            });
        }
    }

    // Add handlers for simultaneous download coordination
    const handleReadyResponse = (data, fromPeerId) => {
        if (data.type === MESSAGE_TYPES.SIMULTANEOUS_DOWNLOAD_READY && data.fileId === fileInfo.fileId) {
            readyPeers.add(fromPeerId);
            if (readyPeers.size === downloadingPeers.size) {
                startDownloadForAll();
            }
        }
    };

    // Update connection handler to handle simultaneous downloads
    const originalDataHandler = conn.dataHandler;
    conn.on('data', (data) => {
        if (data.type === MESSAGE_TYPES.SIMULTANEOUS_DOWNLOAD_READY) {
            handleReadyResponse(data, conn.peer);
        } else {
            originalDataHandler(data);
        }
    });
}

// Update the download button click handler
function createDownloadButton(fileInfo) {
    const downloadButton = document.createElement('button');
    downloadButton.textContent = 'Download';
    downloadButton.classList.add('download-button');
    downloadButton.onclick = async () => {
        try {
            showNotification(`Starting download of ${fileInfo.fileName}...`);
            await initiateSimultaneousDownload(fileInfo);
        } catch (error) {
            console.error('Error initiating simultaneous download:', error);
            showNotification(`Failed to download ${fileInfo.fileName}: ${error.message}`, 'error');
        }
    };
    return downloadButton;
}

// Check if peer ID editing is allowed
function isEditingAllowed() {
    const statusText = elements.statusText.textContent;
    const hasConnections = connections.size > 0;
    return statusText === 'Ready to connect' && !hasConnections;
}

// Update edit button state based on connection status
function updateEditButtonState() {
    if (elements.editIdButton) {
        const canEdit = isEditingAllowed();
        elements.editIdButton.disabled = !canEdit;
        elements.editIdButton.title = canEdit ? 'Edit ID' : 'Cannot edit ID while connected';
    }
}

// Start editing peer ID
function startEditingPeerId() {
    if (!isEditingAllowed()) return;
    
    const currentId = elements.peerId.textContent;
    
    // Track peer ID edit start
    Analytics.track('peer_id_edit_started', {
        current_peer_id_length: currentId.length,
        device_type: Analytics.getDeviceType()
    });
    
    elements.peerIdEdit.value = currentId;
    
    elements.peerId.classList.add('hidden');
    elements.peerIdEdit.classList.remove('hidden');
    elements.editIdButton.classList.add('hidden');
    elements.saveIdButton.classList.remove('hidden');
    elements.cancelEditButton.classList.remove('hidden');
    elements.peerIdEdit.focus();
    elements.peerIdEdit.select();
}

// Save edited peer ID
async function saveEditedPeerId() {
    const newPeerId = elements.peerIdEdit.value.trim();
    
    if (!newPeerId) {
        showNotification('Peer ID cannot be empty', 'error');
        return;
    }
    
    if (newPeerId.length < 3) {
        showNotification('Peer ID must be at least 3 characters', 'error');
        return;
    }

    // Validate peer ID format
    const validIdRegex = /^[A-Za-z0-9_-]+$/;
    if (!validIdRegex.test(newPeerId)) {
        showNotification('Peer ID can only contain letters, numbers, underscores, and hyphens', 'error');
        return;
    }
    
    try {
        // Show loading state
        updateConnectionStatus('connecting', 'Updating peer ID...');
        
        // Destroy existing peer if any
        if (peer) {
            peer.destroy();
            peer = null;
        }
        
        // Clear connections
        connections.clear();
        
        // Initialize new peer with custom ID
        peer = new Peer(newPeerId, {
            debug: 2,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:global.stun.twilio.com:3478' }
                ]
            }
        });
        
        setupPeerHandlers();
        
        // Wait for the peer to be ready
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout waiting for peer to open'));
            }, 10000); // 10 second timeout

            peer.once('open', () => {
                clearTimeout(timeout);
                resolve();
            });

            peer.once('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });
        });

        // Update UI
        elements.peerId.textContent = newPeerId;
        cancelEditingPeerId();
        
        // Generate new QR code
        generateQRCode(newPeerId);
        
        showNotification('Peer ID updated successfully', 'success');
        
        // Track successful peer ID change
        Analytics.track('peer_id_changed_success', {
            new_peer_id_length: newPeerId.length,
            device_type: Analytics.getDeviceType()
        });
    } catch (error) {
        console.error('Error updating peer ID:', error);
        
        // Show specific error message for taken IDs
        if (error.type === 'unavailable-id') {
            showNotification('This ID is already taken. Please try another one.', 'error');
            // Track specific error type
            Analytics.track('peer_id_change_failed', {
                error_type: 'unavailable_id',
                attempted_peer_id_length: newPeerId.length
            });
        } else {
            showNotification('Failed to update peer ID. Please try again.', 'error');
            // Track general error
            Analytics.track('peer_id_change_failed', {
                error_type: 'general_error',
                error_message: error.message,
                attempted_peer_id_length: newPeerId.length
            });
        }
        
        updateConnectionStatus('', 'Failed to update peer ID');
        
        // Reinitialize with auto-generated ID
        initPeerJS();
    }
}

// Cancel editing peer ID
function cancelEditingPeerId() {
    elements.peerId.classList.remove('hidden');
    elements.peerIdEdit.classList.add('hidden');
    elements.editIdButton.classList.remove('hidden');
    elements.saveIdButton.classList.add('hidden');
    elements.cancelEditButton.classList.add('hidden');
}

// Initialize peer ID editing
function initPeerIdEditing() {
    if (elements.editIdButton) {
        elements.editIdButton.addEventListener('click', startEditingPeerId);
    }
    if (elements.saveIdButton) {
        elements.saveIdButton.addEventListener('click', saveEditedPeerId);
    }
    if (elements.cancelEditButton) {
        elements.cancelEditButton.addEventListener('click', cancelEditingPeerId);
    }
    if (elements.peerIdEdit) {
        elements.peerIdEdit.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                saveEditedPeerId();
            } else if (e.key === 'Escape') {
                cancelEditingPeerId();
            }
        });
    }
}

init();
