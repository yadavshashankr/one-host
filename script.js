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
            // Use cryptographically secure random number generator
            let randomString = '';
            if (window.crypto && window.crypto.getRandomValues) {
                // Generate 9 random bytes and convert to base36
                const randomBytes = new Uint8Array(9);
                window.crypto.getRandomValues(randomBytes);
                // Convert each byte to base36 and join
                randomString = Array.from(randomBytes)
                    .map(byte => byte.toString(36))
                    .join('')
                    .substring(0, 9);
            } else {
                // Fallback for very old browsers (shouldn't happen in modern browsers)
                console.warn('crypto.getRandomValues not available, using Math.random (insecure)');
                randomString = Math.random().toString(36).substr(2, 9);
            }
            this._sessionId = 'session_' + Date.now() + '_' + randomString;
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

// MESSAGE_TYPES is now available globally from constants.js
// Use window.MESSAGE_TYPES or just MESSAGE_TYPES (if loaded after constants.js)

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
    bulkDownloadReceived: document.getElementById('bulk-download-received'),
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
    socialIcons: document.getElementById('social-icons'),
    // Auto mode toggle
    autoModeSwitch: document.getElementById('auto-mode-switch')
};

// Initialize screen wake manager (class loaded from js/services/screenWake.js)
const screenWake = new ScreenWakeManager();

// Initialize device manager (class loaded from js/services/deviceManager.js)
const deviceManager = new DeviceManager();

// Initialize memory monitor (class loaded from js/services/memoryMonitor.js)
const memoryMonitor = new MemoryMonitor();

// Initialize ZIP part manager (class loaded from js/services/zipPartManager.js)
const zipPartManager = new ZipPartManager();

// Initialize bulk download manager (class loaded from js/services/bulkDownloadManager.js)
const bulkDownloadManager = new BulkDownloadManager(memoryMonitor, zipPartManager);

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
let autoModeEnabled = false; // Track auto mode state
let autoModeConnectedAsPeer = false; // Track if connected to auto mode peer (not hosting)
let autoModePeerId = null; // Store the auto mode peer ID we're connected to
let autoModeNotification = null; // Store reference to auto mode notification for dismissal

// Add file history tracking with Sets for uniqueness
const fileHistory = {
    sent: new Set(),
    received: new Set()
};

// Map to store actual file info objects for received files (for ZIP download)
const receivedFileInfoMap = new Map(); // fileId -> fileInfo

// Map to store file info objects for sent files
const sentFileInfoMap = new Map(); // fileId -> fileInfo

// File grouping: Store files by type and peer
const fileGroups = {
    sent: new Map(), // All sent files in one group (key: 'sent')
    received: new Map() // Received files grouped by peer (key: peerId)
};

// Track order of received peer headers (most recent first)
const receivedPeerOrder = []; // Array of peerIds

// Track previous first peer to detect position changes for auto-scroll
let previousFirstReceivedPeer = null;

// Add blob storage for sent files
const sentFileBlobs = new Map(); // Map to store blobs of sent files

// Track all blob URLs for cleanup
const activeBlobURLs = new Set(); // Set to track all created blob URLs

// Track completed file downloads (used as flag - fileId -> true, no longer stores blob URLs)
// Files are cleared from memory after download, users should check Downloads folder
const completedFileBlobURLs = new Map(); // fileId -> true (flag to track downloaded files)

// Track files that were downloaded via bulk download (in ZIP, can't open individually)
const bulkDownloadedFiles = new Set(); // fileId -> true

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
    // Find button in both grouped content and old list structure
    let btn = document.querySelector(`button.icon-button[data-file-id="${fileId}"]`);
    if (!btn) {
        // Also try finding by the list item's data-file-id
        const listItem = document.querySelector(`li.file-item[data-file-id="${fileId}"]`);
        if (listItem) {
            btn = listItem.querySelector('button.icon-button');
        }
    }
    // Always set up progress tracking, even if button isn't found (e.g., header is collapsed)
    // This ensures progress can be restored when header is expanded
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="download-progress-text" translate="no">0%</span>';
        downloadProgressMap.set(fileId, { button: btn, percent: 0 });
    } else {
        // Button not found (header might be collapsed) - still track progress
        // Button reference will be updated when header is expanded and renderFileGroup runs
        downloadProgressMap.set(fileId, { button: null, percent: 0 });
    }
    try {
    await originalRequestAndDownloadBlob(fileInfo);
    } catch (error) {
        // Re-enable button on error if it exists
        if (btn && downloadProgressMap.has(fileId)) {
            btn.disabled = false;
            btn.innerHTML = '<span class="material-icons" translate="no">download</span>';
            downloadProgressMap.delete(fileId);
        } else if (downloadProgressMap.has(fileId)) {
            // Button not found, just remove from tracking
            downloadProgressMap.delete(fileId);
        }
        throw error;
    }
};

// Patch updateProgress to update button percentage for downloads
const originalUpdateProgress = updateProgress;
updateProgress = function(progress, fileId) {
    if (fileId && downloadProgressMap.has(fileId)) {
        const entry = downloadProgressMap.get(fileId);
        const percent = Math.floor(progress);
        if (entry.percent !== percent) {
            entry.percent = percent;
            // Update button if it exists (might be null if header is collapsed)
            if (entry.button) {
                entry.button.innerHTML = `<span class='download-progress-text' translate="no">${percent}%</span>`;
            }
            // Progress is still tracked in downloadProgressMap, will be restored when header is expanded
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
        // Only update button if it exists (might be null if header was collapsed)
        if (entry.button) {
        entry.button.disabled = false;
        entry.button.innerHTML = '<span class="material-icons" translate="no">open_in_new</span>';
        }
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
        
        // Get base URL from CONFIG, respecting current environment
        let baseUrl = window.CONFIG?.BASE_URL;
        
        // Fallback: try to get from ENVIRONMENT_URLS if CONFIG is not available
        if (!baseUrl && window.CONFIG?.ENVIRONMENT) {
            const ENVIRONMENT_URLS = {
                production: 'https://one-host.app/',
                development: 'https://yadavshashankr.github.io/one-host-develop/',
                pro: 'https://yadavshashankr.github.io/one-host-pro/'
            };
            baseUrl = ENVIRONMENT_URLS[window.CONFIG.ENVIRONMENT];
        }
        
        // Last resort fallback: use current page URL (for development/testing)
        if (!baseUrl) {
            console.warn('CONFIG.BASE_URL is not defined, using current page URL as fallback');
            baseUrl = window.location.origin + window.location.pathname;
        }
        
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

// Check if QR code is present and valid
function isQRCodePresent() {
    if (!elements.qrcode) return false;
    // Check if QR code element has children (canvas or img created by QRCode library)
    return elements.qrcode.children.length > 0;
}

// Ensure QR code is displayed - regenerates if missing
function ensureQRCodeDisplayed() {
    try {
        // Get current peer ID from peer object or DOM element
        const peerId = peer?.id || elements.peerId?.textContent;
        
        // Validate peer ID exists and is not in generating state
        if (peerId && peerId !== 'Generating...' && peerId.trim() !== '') {
            // Check if QR code is missing
            if (!isQRCodePresent()) {
                console.log('🔄 QR code missing, regenerating for peer ID:', peerId);
                generateQRCode(peerId);
            } else {
                console.debug('✅ QR code already present');
            }
        } else {
            console.debug('⚠️ Cannot regenerate QR code: peer ID not available');
        }
    } catch (error) {
        console.error('Error ensuring QR code display:', error);
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
        
        // Get base URL from CONFIG, respecting current environment
        let baseUrl = window.CONFIG?.BASE_URL;
        
        // Fallback: try to get from ENVIRONMENT_URLS if CONFIG is not available
        if (!baseUrl && window.CONFIG?.ENVIRONMENT) {
            const ENVIRONMENT_URLS = {
                production: 'https://one-host.app/',
                development: 'https://yadavshashankr.github.io/one-host-develop/',
                pro: 'https://yadavshashankr.github.io/one-host-pro/'
            };
            baseUrl = ENVIRONMENT_URLS[window.CONFIG.ENVIRONMENT];
        }
        
        // Last resort fallback (should not happen if constants.js is loaded correctly)
        if (!baseUrl) {
            console.error('CONFIG.BASE_URL is not defined, cannot generate share URL');
            showNotification('Configuration error: Cannot generate share URL', 'error');
            return;
        }
        
        const qrUrl = `${baseUrl}?peer=${peerId}`;
        
        // Track share button click
        Analytics.track('peer_id_share_clicked', {
            peer_id_length: peerId.length,
            device_type: Analytics.getDeviceType(),
            share_method: 'web_share_api',
            base_url: baseUrl,
            environment: window.CONFIG?.ENVIRONMENT || 'unknown'
        });
        
        await navigator.share({ url: qrUrl });
        showNotification('Share successful!', 'success');
        
        // Track successful share
        Analytics.track('peer_id_shared_successfully', {
            peer_id_length: peerId.length,
            device_type: Analytics.getDeviceType(),
            share_method: 'web_share_api',
            base_url: baseUrl,
            environment: window.CONFIG?.ENVIRONMENT || 'unknown'
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
        
        // Get fresh reference to peer ID element
        const peerIdElement = document.getElementById('peer-id');
        if (peerIdElement) {
            peerIdElement.textContent = id;
            console.log('✅ Peer ID set to:', id);
        } else {
            console.error('❌ Peer ID element not found!');
        }
        
        updateConnectionStatus('', 'Ready to connect');
        generateQRCode(id);
        initShareButton();
        updateEditButtonState();
        
        // Retrieve private IP and update auto mode button visibility after peer ID is generated
        // This ensures DOM is ready and peer is initialized
        console.log('🌐 Retrieving private IP to determine connection type...');
        updateAutoModeButtonVisibility();
    });

    peer.on('connection', (conn) => {
        console.log('Incoming connection from:', conn.peer);
        connections.set(conn.peer, conn);
        updateConnectionStatus('connecting', 'Incoming connection...');
        
        // Activate screen wake when incoming connection is detected
        screenWake.activateFromConnection();
        
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
        // No notification - status change will inform the user

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
        
        // Only try to reconnect if this is not a manual peer ID change
        if (!peer._isChangingId) {
            setTimeout(() => {
                if (peer && !peer.destroyed) {
                    console.log('Attempting to reconnect...');
                    peer.reconnect();
                }
            }, 3000);
        }
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
            peer._isChangingId = true; // Flag to prevent reconnection
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
function setupConnectionHandlers(conn, connectionTimeout = null) {
    conn.on('open', () => {
        console.log('Connection opened with:', conn.peer);
        isConnectionReady = true;
        updateConnectionStatus('connected', `Connected to peer(s) : ${connections.size}`);
        elements.fileTransferSection.classList.remove('hidden');
        
        // Activate screen wake when connection is established
        screenWake.activateFromConnection();
        
        // Dismiss auto mode notification when a peer connects while auto mode is enabled
        // This indicates an auto mode connection was successful
        if (autoModeEnabled && autoModeNotification) {
            console.log('✅ Peer connected while auto mode is enabled, dismissing notification');
            autoModeNotification.remove();
            autoModeNotification = null;
        }
        
        // Scroll to file transfer section on first connection
        if (connections.size === 1 && elements.fileTransferSection) {
            // Use setTimeout to ensure DOM has updated and section is visible
            setTimeout(() => {
                elements.fileTransferSection.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'start',
                    inline: 'nearest'
                });
                console.log('✅ Scrolled to file transfer section');
            }, 100);
        }
        
        addRecentPeer(conn.peer);
        
        // Track successful connection
        Analytics.track('connection_successful', {
            peer_id_length: conn.peer.length,
            total_connections: connections.size,
            device_type: Analytics.getDeviceType(),
            connection_type: conn.type || 'data'
        });
        
        // Clear connection timeout if provided
        if (connectionTimeout) {
            clearTimeout(connectionTimeout);
            console.log('Connection timeout cleared for peer:', conn.peer);
        }
        
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
                case MESSAGE_TYPES.FORCE_DISABLE_AUTO_MODE:
                    await handleForceDisableAutoMode(data, conn);
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
                        // Store file info in Map for ZIP download
                        receivedFileInfoMap.set(data.fileId, fileInfo);
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
                    // Check if this is a ZIP blob request
                    if (pendingBlobRequests.has(data.fileId)) {
                        const request = pendingBlobRequests.get(data.fileId);
                        pendingBlobRequests.delete(data.fileId);
                        request.reject(new Error(data.error || 'Failed to download file'));
                        return;
                    }
                    
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
        
        // Check if this was the auto mode peer connection
        if (autoModeConnectedAsPeer && conn.peer === autoModePeerId) {
            console.log('🔄 Auto mode peer disconnected, resetting peer mode state');
            autoModeConnectedAsPeer = false;
            autoModePeerId = null;
            if (elements.autoModeSwitch) {
                elements.autoModeSwitch.checked = false;
                elements.autoModeSwitch.classList.remove('auto-mode-peer');
            }
        }
        
        connections.delete(conn.peer);
        
        // Clear timeout for this connection
        if (connectionTimeouts.has(conn.peer)) {
            clearTimeout(connectionTimeouts.get(conn.peer));
            connectionTimeouts.delete(conn.peer);
        }
        
        updateConnectionStatus(connections.size > 0 ? 'connected' : '', 
            connections.size > 0 ? `Connected to peer(s) : ${connections.size}` : 'Disconnected');
        
        // Update screen wake state based on remaining connections
        screenWake.updateConnectionState(connections.size);
        
        if (connections.size === 0) {
            // No notification - status change will inform the user
        } else {
            // No notification - status change will inform the user
        }
    });

    conn.on('error', (error) => {
        console.error('Connection Error:', error);
        
        // Clear connection timeout if provided
        if (connectionTimeout) {
            clearTimeout(connectionTimeout);
            console.log('Connection timeout cleared due to error for peer:', conn.peer);
        }
        
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

    conn.on('close', () => {
        console.log('Connection closed with:', conn.peer);
        
        // Check if this was the auto mode peer connection
        if (autoModeConnectedAsPeer && conn.peer === autoModePeerId) {
            console.log('🔄 Auto mode peer disconnected, resetting peer mode state');
            autoModeConnectedAsPeer = false;
            autoModePeerId = null;
            if (elements.autoModeSwitch) {
                elements.autoModeSwitch.checked = false;
                elements.autoModeSwitch.classList.remove('auto-mode-peer');
            }
        }
        
        // Clear connection timeout if provided
        if (connectionTimeout) {
            clearTimeout(connectionTimeout);
            console.log('Connection timeout cleared due to close for peer:', conn.peer);
        }
        
        // Remove from connections
        connections.delete(conn.peer);
        
        // Update status if no more connections
        if (connections.size === 0) {
            updateConnectionStatus('', 'Ready to connect');
            elements.fileTransferSection.classList.add('hidden');
        } else {
            updateConnectionStatus('connected', `Connected to peer(s) : ${connections.size}`);
        }
    });
}

// Helper function to generate unique file ID
function generateFileId(file) {
    return `${file.name}-${file.size}`;
}

// Handle force disable auto mode command from peer
async function handleForceDisableAutoMode(data, conn) {
    console.log(`🔴 Received force disable auto mode command from peer: ${conn.peer}`);
    
    try {
        // Force disable auto mode regardless of state or connections
        let disabled = false;
        const wasHosting = autoModeEnabled;
        const wasConnectedAsPeer = autoModeConnectedAsPeer;
        
        // If hosting auto mode, disable it
        if (autoModeEnabled) {
            console.log('🔄 Force disabling auto mode (hosting mode)');
            await switchFromAutoMode();
            disabled = true;
        }
        
        // If connected as peer to auto mode, disconnect
        if (autoModeConnectedAsPeer) {
            console.log('🔄 Force disconnecting from auto mode peer');
            await switchFromPeerMode();
            disabled = true;
        }
        
        if (disabled) {
            showNotification('Auto mode force disabled by peer request', 'info');
            
            // Track analytics
            Analytics.track('auto_mode_force_disabled_by_peer', {
                device_type: Analytics.getDeviceType(),
                sender_id: data.senderId || conn.peer,
                was_hosting: wasHosting,
                was_connected_as_peer: wasConnectedAsPeer
            });
        } else {
            console.log('⚠️ Auto mode not active, nothing to disable');
        }
    } catch (error) {
        console.error('❌ Error force disabling auto mode:', error);
        showNotification('Failed to disable auto mode', 'error');
    }
}

// Handle file header
async function handleFileHeader(data) {
    console.log('Received file header:', data);
    
    // Check if this is a ZIP blob request
    if (pendingBlobRequests.has(data.fileId)) {
        const request = pendingBlobRequests.get(data.fileId);
        request.fileData.fileName = data.fileName;
        request.fileData.fileType = data.fileType;
        request.fileData.fileSize = data.fileSize;
        request.fileData.receivedSize = 0;
        request.chunks = [];
        return; // Don't process as regular file download
    }
    
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
    // Check if this is a ZIP blob request
    if (pendingBlobRequests.has(data.fileId)) {
        const request = pendingBlobRequests.get(data.fileId);
        request.chunks.push(data.data);
        request.fileData.receivedSize += data.data.byteLength;
        return; // Don't process as regular file download
    }
    
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
    // Check if this is a ZIP blob request
    if (pendingBlobRequests.has(data.fileId)) {
        const request = pendingBlobRequests.get(data.fileId);
        pendingBlobRequests.delete(data.fileId);
        
        try {
            if (request.chunks.length > 0) {
                const blob = new Blob(request.chunks, { type: request.fileData.fileType });
                
                // Verify file size
                if (blob.size !== request.fileData.fileSize) {
                    throw new Error('Received file size does not match expected size');
                }
                
                // Resolve the promise with the blob
                request.resolve(blob);
            } else {
                request.reject(new Error('No chunks received'));
            }
        } catch (error) {
            request.reject(error);
        }
        return; // Don't process as regular file download
    }
    
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
            
            // Update download progress if bulk download is in progress
            if (bulkDownloadProgress.isBulkDownload && bulkDownloadProgress.total > 0) {
                bulkDownloadProgress.completed++;
                showOrUpdateProgressNotification('downloading', bulkDownloadProgress.completed, bulkDownloadProgress.total, 'downloading');
            } else {
                // Only show individual notification if not bulk download
                showNotification(`Downloaded ${fileData.fileName}`, 'success');
            }

            // Update UI to show completed state
            const listItem = document.querySelector(`[data-file-id="${data.fileId}"]`);
            if (listItem) {
                listItem.classList.add('download-completed');
                const downloadButton = listItem.querySelector('.icon-button');
                if (downloadButton) {
                    downloadButton.classList.add('download-completed');
                    downloadButton.innerHTML = '<span class="material-icons" translate="no">open_in_new</span>';
                    downloadButton.title = 'Open file';
                    
                    // Clear any existing blob URL for this file (if re-downloaded)
                    if (completedFileBlobURLs.has(data.fileId)) {
                        const existingValue = completedFileBlobURLs.get(data.fileId);
                        // If it's a blob URL (string), revoke it
                        if (typeof existingValue === 'string') {
                            URL.revokeObjectURL(existingValue);
                            activeBlobURLs.delete(existingValue);
                        }
                        completedFileBlobURLs.delete(data.fileId);
                    }
                    
                    // Mark file as downloaded (without storing blob URL - file is in Downloads folder)
                    completedFileBlobURLs.set(data.fileId, true); // Use as flag to track downloaded files
                    
                    // Show notification when user clicks to open
                    downloadButton.onclick = () => {
                        // Track file open click
                        Analytics.track('file_open_clicked', {
                            file_size: blob.size,
                            file_type: Analytics.getFileExtension(fileData.fileName),
                            device_type: Analytics.getDeviceType()
                        });
                        showNotification('Please check your Downloads folder', 'info');
                    };
                }
                
                // Update bulk download button state when a file is completed
                updateBulkDownloadButtonState();
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
            // Store file info in Map for ZIP download
            receivedFileInfoMap.set(data.fileId, fileInfo);
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

// Map to store pending blob requests for ZIP creation
const pendingBlobRequests = new Map(); // fileId -> { resolve, reject, chunks, fileData }

// Function to request a blob from peer (for ZIP creation, doesn't trigger download)
async function requestBlobFromPeer(fileInfo) {
    return new Promise(async (resolve, reject) => {
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

            // Set up blob request tracking
            const requestId = fileInfo.id;
            const fileData = {
                chunks: [],
                receivedSize: 0,
                fileName: fileInfo.name,
                fileType: fileInfo.type,
                fileSize: fileInfo.size
            };

            pendingBlobRequests.set(requestId, {
                resolve,
                reject,
                chunks: fileData.chunks,
                fileData: fileData
            });

            // Request the file directly
            conn.send({
                type: 'blob-request',
                fileId: fileInfo.id,
                fileName: fileInfo.name,
                directRequest: true,
                forZip: true // Flag to indicate this is for ZIP, not direct download
            });

            // Set timeout for blob request
            setTimeout(() => {
                if (pendingBlobRequests.has(requestId)) {
                    pendingBlobRequests.delete(requestId);
                    reject(new Error('Blob request timeout'));
                }
            }, 60000); // 60 second timeout

        } catch (error) {
            console.error('Error requesting blob:', error);
            reject(error);
        }
    });
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

// Function to download all received files that haven't been downloaded yet
async function downloadAllReceivedFiles() {
    const receivedList = elements.receivedFilesList;
    if (!receivedList) {
        console.error('Received files list not found');
        return;
    }

    // Collect all files from all peer groups (regardless of expanded/collapsed state)
    const allFiles = [];
    for (const [peerId, files] of fileGroups.received.entries()) {
        allFiles.push(...files);
    }
    
    // Filter out already downloaded files
    const undownloadedFiles = allFiles.filter(fileInfo => {
        const fileId = fileInfo.id;
        // Check if file is marked as completed in DOM
        const listItem = document.querySelector(`li.file-item[data-file-id="${fileId}"]`);
        const isCompletedInDOM = listItem && listItem.classList.contains('download-completed');
        // Check if file was individually downloaded (tracked in completedFileBlobURLs)
        const hasBlobURL = completedFileBlobURLs.has(fileId);
        // Check if file was bulk downloaded (in ZIP)
        const wasBulkDownloaded = bulkDownloadedFiles.has(fileId);
        return !isCompletedInDOM && !hasBlobURL && !wasBulkDownloaded;
    });
    
    if (undownloadedFiles.length === 0) {
        showNotification('All files already downloaded', 'info');
        return;
    }
    
    // Sort files by size (smallest to largest) for optimal download order
    // This ensures smaller files download first, providing faster feedback and better UX
    undownloadedFiles.sort((a, b) => {
        const sizeA = a.size || 0;
        const sizeB = b.size || 0;
        return sizeA - sizeB;
    });
    
    // Create file items for the bulk download manager
    // The bulk download manager needs DOM elements with data-file-id attributes
    // We'll create temporary items for all undownloaded files in sorted order
    const fileItems = [];
    const seenIds = new Set();
    const fileInfoMap = new Map(); // Map fileId to fileInfo for quick lookup
    
    // Build a map of fileId to fileInfo for quick lookup
    undownloadedFiles.forEach(fileInfo => {
        fileInfoMap.set(fileInfo.id, fileInfo);
        // Ensure fileInfo is in receivedFileInfoMap (it should be, but double-check)
        if (!receivedFileInfoMap.has(fileInfo.id)) {
            receivedFileInfoMap.set(fileInfo.id, fileInfo);
        }
    });
    
    // First, try to find existing DOM elements (from expanded groups) in sorted order
    const allContentContainers = document.querySelectorAll('.file-group-content[data-group-type="received"]');
    const domItemsMap = new Map(); // Map fileId to DOM element
    
    allContentContainers.forEach(container => {
        const items = container.querySelectorAll('li.file-item');
        items.forEach(item => {
            const fileId = item.getAttribute('data-file-id');
            if (fileId && fileInfoMap.has(fileId)) {
                domItemsMap.set(fileId, item);
            }
        });
    });
    
    // Process files in sorted order (smallest to largest)
    undownloadedFiles.forEach(fileInfo => {
        const fileId = fileInfo.id;
        if (seenIds.has(fileId)) return;
        
        // Use existing DOM element if available, otherwise create temporary item
        let item = domItemsMap.get(fileId);
        if (!item) {
            // Create a temporary list item for the bulk download manager
            item = document.createElement('li');
            item.className = 'file-item';
            item.setAttribute('data-file-id', fileId);
        }
        
        fileItems.push(item);
        seenIds.add(fileId);
    });
    
    if (fileItems.length === 0) {
        showNotification('All files already downloaded', 'info');
        return;
    }
    
    console.log(`📦 Bulk download: Found ${fileItems.length} files from ${fileGroups.received.size} peer(s)`);

    // Disable button during download
    if (elements.bulkDownloadReceived) {
        elements.bulkDownloadReceived.disabled = true;
    }

    // Track bulk download initiation
    Analytics.track('bulk_download_initiated', {
        file_count: fileItems.length,
        device_type: Analytics.getDeviceType(),
        download_method: 'zip_parts'
    });

    // Smart ZIP batching: Categorize files into ZIP batches and individual downloads
    const ZIP_SIZE_LIMIT = 400 * 1024 * 1024; // 400MB in bytes - maximum size of a ZIP batch
    const INDIVIDUAL_DOWNLOAD_THRESHOLD = 350 * 1024 * 1024; // 350MB in bytes - files above this are downloaded individually
    const zipBatches = []; // Array of fileInfo arrays for ZIP batches
    const individualFiles = []; // Files to download individually
    let currentBatch = [];
    let currentBatchSize = 0;
    
    // Create a map of fileId to fileItem for later use
    const fileItemMap = new Map();
    fileItems.forEach(item => {
        const fileId = item.getAttribute('data-file-id');
        if (fileId) {
            fileItemMap.set(fileId, item);
        }
    });
    
    // Process files in sorted order (smallest to largest)
    for (let i = 0; i < undownloadedFiles.length; i++) {
        const fileInfo = undownloadedFiles[i];
        const fileSize = fileInfo.size || 0;
        
        // If file exceeds 350MB, always download individually (not in ZIP)
        if (fileSize > INDIVIDUAL_DOWNLOAD_THRESHOLD) {
            individualFiles.push(fileInfo);
            continue;
        }
        
        // Check if file fits in current batch (batch size limit is still 400MB)
        if (currentBatchSize + fileSize <= ZIP_SIZE_LIMIT) {
            // File fits, add to current batch
            currentBatch.push(fileInfo);
            currentBatchSize += fileSize;
        } else {
            // File doesn't fit in current batch
            // Save current batch if it has files
            if (currentBatch.length > 0) {
                zipBatches.push([...currentBatch]);
                currentBatch = [];
                currentBatchSize = 0;
            }
            
            // Check if this file can fit with any remaining files
            let canFitWithRemaining = false;
            let testSize = fileSize;
            
            // Check remaining files to see if any can fit with this file
            for (let j = i + 1; j < undownloadedFiles.length; j++) {
                const remainingFile = undownloadedFiles[j];
                const remainingSize = remainingFile.size || 0;
                
                // Skip files that exceed 350MB threshold (they should be downloaded individually)
                if (remainingSize > INDIVIDUAL_DOWNLOAD_THRESHOLD) continue;
                
                if (testSize + remainingSize <= ZIP_SIZE_LIMIT) {
                    canFitWithRemaining = true;
                    break;
                }
            }
            
            if (canFitWithRemaining) {
                // File can fit with remaining files, start new batch
                currentBatch.push(fileInfo);
                currentBatchSize = fileSize;
            } else {
                // File cannot fit with any remaining files, download individually
                individualFiles.push(fileInfo);
            }
        }
    }
    
    // Add final batch if it has files
    if (currentBatch.length > 0) {
        zipBatches.push(currentBatch);
    }
    
    console.log(`📦 Categorized: ${zipBatches.length} ZIP batch(es), ${individualFiles.length} individual file(s)`);

    // Show initial progress notification
    const totalFiles = fileItems.length;
    showOrUpdateProgressNotification('downloading', 0, totalFiles, 'downloading');
    
    const allSuccessfulFileIds = new Set();
    const allErrors = [];
    let totalCompleted = 0;

    try {
        // Process ZIP batches through BulkDownloadManager
        if (zipBatches.length > 0) {
            for (let batchIndex = 0; batchIndex < zipBatches.length; batchIndex++) {
                const batch = zipBatches[batchIndex];
                
                // Create fileItems for this batch
                const batchFileItems = batch.map(fileInfo => {
                    const fileId = fileInfo.id;
                    return fileItemMap.get(fileId) || (() => {
                        const tempItem = document.createElement('li');
                        tempItem.className = 'file-item';
                        tempItem.setAttribute('data-file-id', fileId);
                        return tempItem;
                    })();
                });
                
                console.log(`📦 Processing ZIP batch ${batchIndex + 1}/${zipBatches.length} with ${batch.length} files`);
                
                // Process batch through BulkDownloadManager
                const zipResult = await bulkDownloadManager.downloadAllFiles(batchFileItems, {
            receivedFileInfoMap: receivedFileInfoMap,
            requestBlobFromPeer: requestBlobFromPeer,
                    showOrUpdateProgressNotification: (key, current, total, operation) => {
                        // Update progress including individual files completed
                        showOrUpdateProgressNotification('downloading', totalCompleted + current, totalFiles, operation);
                    },
            downloadBlob: downloadBlob,
            activeBlobURLs: activeBlobURLs
        });
                
                // Track successful files from ZIP
                zipResult.successfulFileIds.forEach(fileId => {
                    allSuccessfulFileIds.add(fileId);
                    bulkDownloadedFiles.add(fileId);
                    totalCompleted++;
                });
                
                allErrors.push(...zipResult.errors);
            }
        }
        
        // Process individual files with progress tracking
        if (individualFiles.length > 0) {
            console.log(`📥 Processing ${individualFiles.length} individual file(s)`);
            
            for (let i = 0; i < individualFiles.length; i++) {
                const fileInfo = individualFiles[i];
                const fileId = fileInfo.id;
                
                try {
                    // Update progress
                    showOrUpdateProgressNotification('downloading', totalCompleted, totalFiles, 'downloading');
                    
                    // Download file individually (this will show progress via downloadProgressMap)
                    await requestAndDownloadBlob(fileInfo);
                    
                    // Mark as successfully downloaded (individually, not in ZIP)
                    allSuccessfulFileIds.add(fileId);
                    totalCompleted++;
                    
                    // Update progress after completion
                    showOrUpdateProgressNotification('downloading', totalCompleted, totalFiles, 'downloading');
                    
                } catch (error) {
                    console.error(`Error downloading individual file ${fileInfo.name}:`, error);
                    allErrors.push(fileInfo.name);
                }
            }
        }
        
        // Create result object similar to BulkDownloadManager format
        const result = {
            successCount: totalCompleted,
            errors: allErrors,
            partsCreated: zipBatches.length,
            successfulFileIds: allSuccessfulFileIds
        };

        if (result.successCount === 0) {
            throw new Error('Failed to fetch any files');
        }

        // Mark files as downloaded based on how they were downloaded
        // ZIP files: mark in bulkDownloadedFiles
        // Individual files: already handled by requestAndDownloadBlob (stored in completedFileBlobURLs)
        
        // Create sets to distinguish ZIP files from individual files
        const zipFileIds = new Set();
        zipBatches.forEach(batch => {
            batch.forEach(fileInfo => {
                if (result.successfulFileIds.has(fileInfo.id)) {
                    zipFileIds.add(fileInfo.id);
                    bulkDownloadedFiles.add(fileInfo.id);
                }
            });
        });
        
        const individualFileIds = new Set();
        individualFiles.forEach(fileInfo => {
            if (result.successfulFileIds.has(fileInfo.id)) {
                individualFileIds.add(fileInfo.id);
                // Individual files are already tracked in completedFileBlobURLs by requestAndDownloadBlob
            }
        });
        
        // Update DOM elements for ZIP files
        for (const fileId of zipFileIds) {
            const allItems = document.querySelectorAll(`li.file-item[data-file-id="${fileId}"]`);
            allItems.forEach(li => {
                li.classList.add('download-completed');
                const btn = li.querySelector('.icon-button');
                if (btn) {
                    btn.classList.add('download-completed');
                    btn.disabled = false;
                    btn.innerHTML = '<span class="material-icons" translate="no">open_in_new</span>';
                    btn.title = 'File included in ZIP';
                    // Set onclick to show message (files in ZIP can't be opened individually)
                    btn.onclick = () => {
                        showNotification('This file was downloaded in a ZIP archive. Check your downloads folder.', 'info');
                    };
                }
            });
        }
        
        // Individual files are already updated by requestAndDownloadBlob via downloadBlob function
        // which sets up the open_in_new icon and onclick handler
        
        // Expand all received file groups temporarily to update their UI, then collapse them back
        // This ensures all files show as completed even if groups were collapsed
        const allReceivedHeaders = document.querySelectorAll('.file-group-header[data-group-type="received"]');
        const expandedHeaders = [];
        
        // Expand all collapsed groups
        allReceivedHeaders.forEach(header => {
            const isExpanded = header.getAttribute('data-expanded') === 'true';
            if (!isExpanded) {
                const peerId = header.getAttribute('data-group-key');
                toggleFileGroup('received', peerId);
                expandedHeaders.push(peerId);
            }
        });
        
        // Re-render all groups to update UI state
        renderAllFileGroups();
        
        // Re-render all expanded groups to update file items
        allReceivedHeaders.forEach(header => {
            const peerId = header.getAttribute('data-group-key');
            if (header.getAttribute('data-expanded') === 'true') {
                renderFileGroup('received', peerId);
            }
        });
        
        // Collapse groups that were originally collapsed
        expandedHeaders.forEach(peerId => {
            const header = document.getElementById(`received-files-header-${peerId}`);
            if (header && header.getAttribute('data-expanded') === 'true') {
                toggleFileGroup('received', peerId);
            }
        });
        
        // Update bulk download button state
        updateBulkDownloadButtonState();

        // Show success notification
        const partText = result.partsCreated > 1 ? ` in ${result.partsCreated} part(s)` : '';
        if (result.errors.length === 0) {
            showNotification(`Successfully downloaded ${result.successCount} file(s)${partText}`, 'success');
        } else {
            showNotification(`Downloaded ${result.successCount} file(s)${partText}, ${result.errors.length} failed`, 'warning');
        }

        // Track bulk download completion
        Analytics.track('bulk_download_completed', {
            total_files: fileItems.length,
            success_count: result.successCount,
            fail_count: result.errors.length,
            parts_created: result.partsCreated,
            device_type: Analytics.getDeviceType(),
            download_method: 'zip_parts'
        });

    } catch (error) {
        console.error('Error in bulk download:', error);
        showNotification(`Failed to download files: ${error.message}`, 'error');
        
        // Track bulk download failure
        Analytics.track('bulk_download_failed', {
            error_message: error.message,
            device_type: Analytics.getDeviceType(),
            download_method: 'zip_parts'
        });
    } finally {
        // Update notification with final status instead of removing it
        // Notification will persist with X close button for manual dismissal
        const finalCompleted = totalCompleted; // Use the actual completed count
        const finalTotal = fileItems.length; // Total files attempted
        
        // Update notification to show final status (Downloaded instead of Downloading)
        showOrUpdateProgressNotification('downloading', finalCompleted, finalTotal, 'downloading', true);
        
        // Note: Download prompt notification will also persist - user can dismiss both manually
        
        // Re-enable button
        if (elements.bulkDownloadReceived) {
            elements.bulkDownloadReceived.disabled = false;
        }
        // Update button state
        updateBulkDownloadButtonState();
    }
}

// Function to update bulk download button state (enable/disable and show/hide based on available files)
function updateBulkDownloadButtonState() {
    if (!elements.bulkDownloadReceived || !elements.receivedFilesList) {
        return;
    }

    // Count all received files (from all groups)
    let totalFiles = 0;
    let undownloadedFiles = 0;
    
    for (const files of fileGroups.received.values()) {
        totalFiles += files.length;
        undownloadedFiles += files.filter(f => {
            // Check if file is marked as downloaded
            const fileId = f.id;
            // Check tracking Sets (most reliable source of truth)
            // If file is in either tracking Set, it's downloaded
            if (completedFileBlobURLs.has(fileId) || bulkDownloadedFiles.has(fileId)) {
                return false; // File is downloaded
            }
            // If not in tracking Sets, file is not downloaded
            return true;
        }).length;
    }
    
    // Hide button if less than 2 files, show if 2 or more
    if (totalFiles < 2) {
        elements.bulkDownloadReceived.style.display = 'none';
        elements.bulkDownloadReceived.disabled = true;
    } else {
        elements.bulkDownloadReceived.style.display = 'flex';
        // Enable button if there are files to download (disable if all files are downloaded)
        elements.bulkDownloadReceived.disabled = undownloadedFiles === 0;
    }
    
    console.log(`📊 Bulk download: ${totalFiles} total, ${undownloadedFiles} undownloaded, button ${elements.bulkDownloadReceived.disabled ? 'disabled' : 'enabled'}`);
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
    
    // Remove file from old group if it exists
    removeFileFromGroup(fileId, actualType === 'sent' ? 'sent' : 'received');
    
    // Update UI with the correct list (this will add to group and render)
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
    const totalFiles = fileQueue.length;
    let completedFiles = 0;
    
    // Show initial progress notification
    showOrUpdateProgressNotification('sending', 0, totalFiles, 'sending');
    updateTransferInfo(`Processing queue: ${fileQueue.length} file(s) remaining`);
    
    while (fileQueue.length > 0) {
        const file = fileQueue.shift();
        try {
            await sendFile(file);
            completedFiles++;
            // Update progress notification
            showOrUpdateProgressNotification('sending', completedFiles, totalFiles, 'sending');
            // Small delay between files to prevent overwhelming the connection
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
            console.error('Error processing file from queue:', error);
            completedFiles++;
            // Update progress even on error
            showOrUpdateProgressNotification('sending', completedFiles, totalFiles, 'sending');
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
            // Only show individual notification if not processing queue (single file send)
            if (!isProcessingQueue) {
                showNotification(`${file.name} sent successfully`, 'success');
            }
            
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
    nameSpan.innerHTML = `${name} (${formatFileSize(size)})`;
    nameSpan.setAttribute('translate', 'no');
    nameSpan.setAttribute('data-no-translate', 'true');
    
    const downloadBtn = document.createElement('a');
    downloadBtn.href = url;
    downloadBtn.download = name;
    downloadBtn.className = 'button';
    downloadBtn.textContent = 'Download';
    downloadBtn.setAttribute('data-translate-key', 'download_button');
    
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
    
    // Add translation protection to file size units
    return `<span translate="no">${size.toFixed(1)} ${units[unitIndex]}</span>`;
}

// Track active progress notifications
const activeProgressNotifications = {
    sending: null,
    downloading: null,
    downloadPrompt: null // Notification about allowing download prompts
};

// Track bulk download progress
let bulkDownloadProgress = {
    total: 0,
    completed: 0,
    isBulkDownload: false
};

function showNotification(message, type = 'info', duration = 5000) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    // Support line breaks by replacing \n with <br> and using innerHTML
    const formattedMessage = message.charAt(0).toUpperCase() + message.slice(1).replace(/\n/g, '<br>');
    notification.innerHTML = formattedMessage;
    
    elements.notifications.appendChild(notification);
    
    // Only auto-remove if duration is greater than 0
    if (duration > 0) {
        setTimeout(() => {
            notification.remove();
        }, duration);
    }
    
    return notification; // Return notification element for manual dismissal
}

// Function to show or update a progress notification for multiple files
function showOrUpdateProgressNotification(key, current, total, operation = 'sending', isComplete = false) {
    // Determine operation text based on completion status
    // Only show "Downloaded" when isComplete is explicitly true (process is done)
    // During download, even if current >= total, keep showing "Downloading" until isComplete
    let operationText;
    if (isComplete) {
        operationText = operation === 'sending' ? 'Sent' : 'Downloaded';
    } else {
        operationText = operation === 'sending' ? 'Sending' : 'Downloading';
    }
    const message = `${operationText} files: ${current}/${total}`;
    
    let notification = activeProgressNotifications[key];
    
    if (!notification) {
        // Create new notification
        notification = document.createElement('div');
        notification.className = `notification info progress-notification`;
        notification.setAttribute('data-progress-key', key);
        notification.style.position = 'relative';
        
        // Create content container (no padding initially - will add if isComplete)
        const content = document.createElement('div');
        notification.appendChild(content);
        
        elements.notifications.appendChild(notification);
        activeProgressNotifications[key] = notification;
        
        // If this is a downloading notification, show the download prompt notification on top
        // (but only show X button on prompt when download is complete)
        if (key === 'downloading' && !activeProgressNotifications.downloadPrompt) {
            const promptNotification = document.createElement('div');
            promptNotification.className = 'notification info download-prompt-notification';
            promptNotification.style.position = 'relative';
            
            const promptContent = document.createElement('div');
            promptContent.innerHTML = 'Allow all download prompts as soon as they appear on the screen to ensure successful downloads.';
            promptNotification.appendChild(promptContent);
            
            // Insert before the download notification to appear on top
            elements.notifications.insertBefore(promptNotification, notification);
            activeProgressNotifications.downloadPrompt = promptNotification;
        }
    }
    
    // Update notification content
    const content = notification.firstElementChild;
    if (content && content.tagName === 'DIV') {
        content.textContent = message;
    } else {
        // Fallback: if structure is different, update directly
        const allDivs = notification.querySelectorAll('div');
        if (allDivs.length > 0) {
            allDivs[0].textContent = message;
        }
    }
    
    // Handle X close button and auto-dismiss based on completion status
    const existingCloseButton = notification.querySelector('.notification-close');
    
    if (isComplete) {
        // When complete: Add X close button if not already present, and persist notification
        if (!existingCloseButton) {
            const closeButton = document.createElement('button');
            closeButton.className = 'notification-close';
            closeButton.innerHTML = '×';
            closeButton.setAttribute('aria-label', 'Close notification');
            closeButton.style.cssText = `
                position: absolute;
                top: 8px;
                right: 8px;
                background: none;
                border: none;
                font-size: 24px;
                line-height: 1;
                cursor: pointer;
                color: inherit;
                opacity: 0.7;
                padding: 4px 8px;
                transition: opacity 0.2s;
            `;
            closeButton.addEventListener('mouseenter', () => {
                closeButton.style.opacity = '1';
            });
            closeButton.addEventListener('mouseleave', () => {
                closeButton.style.opacity = '0.7';
            });
            
            // Dismiss function
            const dismissNotification = () => {
                if (notification && notification.parentNode) {
                    notification.style.opacity = '0';
                    notification.style.transform = 'translateX(100%)';
                    setTimeout(() => {
                        notification.remove();
                    }, 300);
                }
                activeProgressNotifications[key] = null;
                
                // Also dismiss the download prompt notification if it exists
                if (key === 'downloading' && activeProgressNotifications.downloadPrompt) {
                    const promptNotification = activeProgressNotifications.downloadPrompt;
                    if (promptNotification && promptNotification.parentNode) {
                        promptNotification.style.opacity = '0';
                        promptNotification.style.transform = 'translateX(100%)';
                        setTimeout(() => {
                            promptNotification.remove();
                        }, 300);
                    }
                    activeProgressNotifications.downloadPrompt = null;
                }
            };
            
            closeButton.addEventListener('click', (e) => {
                e.stopPropagation();
                dismissNotification();
            });
            
            // Add padding to content for X button
            if (content) {
                content.style.paddingRight = '32px';
            }
            
            notification.appendChild(closeButton);
        }
        
        // Also add X button to download prompt notification if it exists
        if (key === 'downloading' && activeProgressNotifications.downloadPrompt) {
            const promptNotification = activeProgressNotifications.downloadPrompt;
            const promptCloseButton = promptNotification.querySelector('.notification-close');
            
            if (!promptCloseButton) {
                const newPromptCloseButton = document.createElement('button');
                newPromptCloseButton.className = 'notification-close';
                newPromptCloseButton.innerHTML = '×';
                newPromptCloseButton.setAttribute('aria-label', 'Close notification');
                newPromptCloseButton.style.cssText = `
                    position: absolute;
                    top: 8px;
                    right: 8px;
                    background: none;
                    border: none;
                    font-size: 24px;
                    line-height: 1;
                    cursor: pointer;
                    color: inherit;
                    opacity: 0.7;
                    padding: 4px 8px;
                    transition: opacity 0.2s;
                `;
                newPromptCloseButton.addEventListener('mouseenter', () => {
                    newPromptCloseButton.style.opacity = '1';
                });
                newPromptCloseButton.addEventListener('mouseleave', () => {
                    newPromptCloseButton.style.opacity = '0.7';
                });
                
                newPromptCloseButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (promptNotification && promptNotification.parentNode) {
                        promptNotification.style.opacity = '0';
                        promptNotification.style.transform = 'translateX(100%)';
                        setTimeout(() => {
                            promptNotification.remove();
                        }, 300);
                    }
                    activeProgressNotifications.downloadPrompt = null;
                });
                
                const promptContent = promptNotification.firstElementChild;
                if (promptContent) {
                    promptContent.style.paddingRight = '32px';
                }
                promptNotification.appendChild(newPromptCloseButton);
            }
        }
    } else {
        // When not complete: Remove X button if present, and auto-dismiss when done
        if (existingCloseButton) {
            existingCloseButton.remove();
            if (content) {
                content.style.paddingRight = '';
            }
        }
        
        // Auto-dismiss when all files are done (for sending/downloading notifications)
        if (current >= total) {
            setTimeout(() => {
                if (notification && notification.parentNode) {
                    notification.remove();
                }
                activeProgressNotifications[key] = null;
                
                // Also dismiss the download prompt notification if it exists
                if (key === 'downloading' && activeProgressNotifications.downloadPrompt) {
                    const promptNotification = activeProgressNotifications.downloadPrompt;
                    if (promptNotification && promptNotification.parentNode) {
                        promptNotification.remove();
                    }
                    activeProgressNotifications.downloadPrompt = null;
                }
            }, 2000);
        }
    }
    
    return notification;
}

// Show tip notification with X button and click-to-dismiss functionality
function showTipNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type} tip-notification`;
    notification.style.position = 'relative';
    
    // Support line breaks by replacing \n with <br> and using innerHTML
    const formattedMessage = message.replace(/\n/g, '<br>');
    
    // Create X button
    const closeButton = document.createElement('button');
    closeButton.className = 'notification-close';
    closeButton.innerHTML = '×';
    closeButton.setAttribute('aria-label', 'Close notification');
    closeButton.style.cssText = `
        position: absolute;
        top: 8px;
        right: 8px;
        background: none;
        border: none;
        font-size: 24px;
        line-height: 1;
        cursor: pointer;
        color: inherit;
        opacity: 0.7;
        padding: 4px 8px;
        transition: opacity 0.2s;
    `;
    closeButton.addEventListener('mouseenter', () => {
        closeButton.style.opacity = '1';
    });
    closeButton.addEventListener('mouseleave', () => {
        closeButton.style.opacity = '0.7';
    });
    
    // Add content
    const content = document.createElement('div');
    content.innerHTML = formattedMessage;
    content.style.paddingRight = '32px'; // Space for X button
    
    notification.appendChild(content);
    notification.appendChild(closeButton);
    
    // Store handler reference for cleanup
    let documentClickHandler = null;
    let isDismissed = false;
    
    // Dismiss function
    const dismissNotification = () => {
        if (isDismissed) return; // Prevent multiple dismissals
        isDismissed = true;
        
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            notification.remove();
            // Remove document click listener if it exists
            if (documentClickHandler) {
                document.removeEventListener('click', documentClickHandler, true);
                documentClickHandler = null;
            }
        }, 300);
    };
    
    // Handle X button click
    closeButton.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent document click from firing
        dismissNotification();
    });
    
    // Handle document click (anywhere on page, outside notification)
    documentClickHandler = (e) => {
        // Don't dismiss if clicking inside the notification
        if (!notification.contains(e.target)) {
            dismissNotification();
        }
    };
    
    // Add document click listener (use capture phase to catch early)
    // Small delay to prevent immediate dismissal on page load
    setTimeout(() => {
        if (!isDismissed) {
            document.addEventListener('click', documentClickHandler, true);
        }
    }, 100);
    
    elements.notifications.appendChild(notification);
    
    return notification;
}

// Show auto mode notification with X button (close only on X click, not on page click)
function showAutoModeNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `notification ${type} auto-mode-notification`;
    notification.style.position = 'relative';
    
    // Support line breaks by replacing \n with <br> and using innerHTML
    const formattedMessage = message.replace(/\n/g, '<br>');
    
    // Create X button
    const closeButton = document.createElement('button');
    closeButton.className = 'notification-close';
    closeButton.innerHTML = '×';
    closeButton.setAttribute('aria-label', 'Close notification');
    closeButton.style.cssText = `
        position: absolute;
        top: 8px;
        right: 8px;
        background: none;
        border: none;
        font-size: 24px;
        line-height: 1;
        cursor: pointer;
        color: inherit;
        opacity: 0.7;
        padding: 4px 8px;
        transition: opacity 0.2s;
    `;
    closeButton.addEventListener('mouseenter', () => {
        closeButton.style.opacity = '1';
    });
    closeButton.addEventListener('mouseleave', () => {
        closeButton.style.opacity = '0.7';
    });
    
    // Add content
    const content = document.createElement('div');
    content.innerHTML = formattedMessage;
    content.style.paddingRight = '32px'; // Space for X button
    
    notification.appendChild(content);
    notification.appendChild(closeButton);
    
    let isDismissed = false;
    
    // Dismiss function
    const dismissNotification = () => {
        if (isDismissed) return; // Prevent multiple dismissals
        isDismissed = true;
        
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            notification.remove();
        }, 300);
    };
    
    // Handle X button click ONLY (no document click handler)
    closeButton.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent event bubbling
        dismissNotification();
    });
    
    elements.notifications.appendChild(notification);
    
    return notification;
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
        
        // Add connection timeout handling
        const connectionTimeout = setTimeout(() => {
            if (connections.has(remotePeerIdValue) && !connections.get(remotePeerIdValue).open) {
                console.error('Connection timeout for peer:', remotePeerIdValue);
                connections.delete(remotePeerIdValue);
                updateConnectionStatus('', 'Connection timeout - peer may be offline');
                showNotification('Connection timeout - peer may be offline or unreachable', 'error');
                
                // Track connection timeout
                Analytics.track('connection_timeout', {
                    target_peer_id: remotePeerIdValue,
                    target_peer_id_length: remotePeerIdValue.length
                });
            }
        }, 15000); // 15 second timeout
        
        connections.set(remotePeerIdValue, newConnection);
        setupConnectionHandlers(newConnection, connectionTimeout);
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

// Bulk download button for received files
if (elements.bulkDownloadReceived) {
    elements.bulkDownloadReceived.addEventListener('click', () => {
        downloadAllReceivedFiles();
    });
}

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
// Check if tip should be shown in this tab (once per tab, not on refresh)
function shouldShowTipInTab(tipKey = 'wake_lock_tip') {
    try {
        // Check if sessionStorage is available
        if (typeof sessionStorage === 'undefined') {
            console.warn('sessionStorage not available');
            return false;
        }
        
        // Check if tip has been shown in THIS tab session
        const tipShown = sessionStorage.getItem(tipKey);
        if (tipShown === 'true') {
            return false; // Already shown in this tab
        }
        
        // Get navigation type
        let navigationType = null;
        
        // Try modern Performance Navigation API first
        if (performance.getEntriesByType) {
            const navEntries = performance.getEntriesByType('navigation');
            if (navEntries.length > 0) {
                navigationType = navEntries[0].type;
            }
        }
        
        // Fallback to legacy API
        if (navigationType === null && performance.navigation) {
            // Legacy API uses numbers: 0=navigate, 1=reload, 2=back_forward
            const navType = performance.navigation.type;
            navigationType = navType === 0 ? 'navigate' : 
                           navType === 1 ? 'reload' : 
                           navType === 2 ? 'back_forward' : null;
        }
        
        // Only show on 'navigate' (first visit in tab)
        if (navigationType === 'navigate') {
            sessionStorage.setItem(tipKey, 'true');
            return true;
        }
        
        return false;
    } catch (error) {
        console.error('Error checking tip visibility:', error);
        return false; // Fail silently
    }
}

function init() {
    if (!checkBrowserSupport()) {
        return;
    }

    initPeerJS();
    initIndexedDB();
    loadRecentPeers();
    checkUrlForPeerId(); // Check URL for peer ID on load
    initConnectionKeepAlive(); // Initialize connection keep-alive system
    
    // Show wake lock tip once per tab on first navigation (not on refresh)
    // Only show on mobile devices and tablets, not on desktops/laptops
    if (shouldShowTipInTab('wake_lock_tip') && deviceManager.isMobileOrTablet()) {
        showTipNotification(
            '💡\nTap anywhere once or interact with the page to enable Wake Mode.\nThis keeps the screen awake, prevents disconnections, and ensures seamless file transfers.',
            'info'
        );
    }
            // Peer ID editing is handled by event delegation in init() function
    initSocialMediaToggle(); // Initialize social media toggle
    initAutoModeToggle(); // Initialize auto mode toggle
    initAutoModeLongPress(); // Initialize long press detection on "Auto" text
    // Note: updateAutoModeButtonVisibility() will be called after peer ID is generated
    // in the peer.on('open') handler to ensure DOM is ready
    
    elements.transferProgress.classList.add('hidden'); // Always hide transfer bar
    
    // Initialize bulk download button state
    updateBulkDownloadButtonState();
    
    // Add event delegation for peer ID editing to handle translation interference
    document.addEventListener('click', (e) => {
        console.log('🖱️ Click detected on:', e.target);
        console.log('🖱️ Click target closest to edit-id:', e.target.closest('#edit-id'));
        
        if (e.target.closest('#edit-id')) {
            console.log('✅ Edit button clicked, calling startEditingPeerId');
            e.preventDefault();
            startEditingPeerId();
        } else if (e.target.closest('#save-id')) {
            console.log('✅ Save button clicked, calling saveEditedPeerId');
            e.preventDefault();
            saveEditedPeerId();
        } else if (e.target.closest('#cancel-edit')) {
            console.log('✅ Cancel button clicked, calling cancelEditingPeerId');
            e.preventDefault();
            cancelEditingPeerId();
        }
    });
}

// Initialize auto mode toggle
function initAutoModeToggle() {
    if (!elements.autoModeSwitch) {
        console.warn('Auto mode switch element not found');
        return;
    }
    
    // Ensure toggle starts as OFF (default state)
    elements.autoModeSwitch.checked = false;
    autoModeEnabled = false;
    
    // Hide auto mode button initially until WiFi/Cellular decision is made
    const autoModeContainer = elements.autoModeSwitch.closest('.auto-mode-toggle-container');
    if (autoModeContainer) {
        autoModeContainer.style.display = 'none';
        console.log('🔒 Auto mode button hidden initially (waiting for connection type detection)');
    }
    
    // Add change event listener
    elements.autoModeSwitch.addEventListener('change', handleAutoModeToggle);
    
    // Initialize toggle state based on current connections
    updateAutoModeToggleState();
    
    console.log('Auto mode toggle initialized');
}

// Initialize long press detection on "Auto" text
function initAutoModeLongPress() {
    const autoLabel = document.querySelector('.toggle-label');
    if (!autoLabel) {
        console.error('Auto label element not found');
        return;
    }
    
    let longPressTimer = null;
    let isLongPressing = false;
    const LONG_PRESS_DURATION = 5000; // 5 seconds
    
    // Visual feedback during long press
    function showLongPressFeedback() {
        autoLabel.style.opacity = '0.5';
        autoLabel.style.transform = 'scale(0.95)';
    }
    
    function resetLongPressFeedback() {
        autoLabel.style.opacity = '';
        autoLabel.style.transform = '';
    }
    
    // Mouse events (desktop)
    autoLabel.addEventListener('mousedown', (e) => {
        e.preventDefault(); // Prevent text selection
        isLongPressing = true;
        showLongPressFeedback();
        
        longPressTimer = setTimeout(() => {
            if (isLongPressing) {
                handleLongPress();
                isLongPressing = false;
            }
        }, LONG_PRESS_DURATION);
    });
    
    autoLabel.addEventListener('mouseup', () => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
        isLongPressing = false;
        resetLongPressFeedback();
    });
    
    autoLabel.addEventListener('mouseleave', () => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
        isLongPressing = false;
        resetLongPressFeedback();
    });
    
    // Touch events (mobile)
    autoLabel.addEventListener('touchstart', (e) => {
        e.preventDefault(); // Prevent default touch behavior
        isLongPressing = true;
        showLongPressFeedback();
        
        longPressTimer = setTimeout(() => {
            if (isLongPressing) {
                handleLongPress();
                isLongPressing = false;
            }
        }, LONG_PRESS_DURATION);
    });
    
    autoLabel.addEventListener('touchend', (e) => {
        e.preventDefault();
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
        isLongPressing = false;
        resetLongPressFeedback();
    });
    
    autoLabel.addEventListener('touchcancel', (e) => {
        e.preventDefault();
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
        isLongPressing = false;
        resetLongPressFeedback();
    });
    
    // Prevent context menu on long press
    autoLabel.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });
    
    // Prevent clicking on "Auto" text from toggling the switch
    autoLabel.addEventListener('click', (e) => {
        e.preventDefault(); // Prevent default label behavior
        e.stopPropagation(); // Stop event from bubbling to label
        console.log('🖱️ Click on "Auto" text prevented - use switch to toggle');
    });
    
    // Handle the long press action
    function handleLongPress() {
        if (connections.size === 0) {
            showNotification('No connected peers to send disable command', 'warning');
            resetLongPressFeedback();
            return;
        }
        
        console.log('🔴 Long press detected on "Auto" - sending force disable command to all peers');
        
        // Send force disable message to all connected peers
        let sentCount = 0;
        connections.forEach((conn, peerId) => {
            if (conn && conn.open) {
                try {
                    conn.send({
                        type: MESSAGE_TYPES.FORCE_DISABLE_AUTO_MODE,
                        timestamp: Date.now(),
                        senderId: peer.id
                    });
                    sentCount++;
                    console.log(`✅ Force disable command sent to peer: ${peerId}`);
                } catch (error) {
                    console.error(`❌ Failed to send force disable to peer ${peerId}:`, error);
                }
            }
        });
        
        if (sentCount > 0) {
            showNotification(`Force disable command sent to ${sentCount} peer(s)`, 'success');
            
            // Track analytics
            Analytics.track('auto_mode_force_disable_sent', {
                device_type: Analytics.getDeviceType(),
                peer_count: sentCount
            });
        } else {
            showNotification('Failed to send force disable command', 'error');
        }
        
        resetLongPressFeedback();
    }
    
    console.log('✅ Long press detection initialized on "Auto" text');
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
    
    // Hide file transfer section when status is "Ready to connect"
    if (message && message.toLowerCase() === 'ready to connect') {
        if (elements.fileTransferSection) {
            elements.fileTransferSection.classList.add('hidden');
            console.log('📁 File transfer section hidden (status: Ready to connect)');
        }
        
        // If auto mode is enabled, check WiFi and disable/hide if not detected
        if (autoModeEnabled) {
            console.log('🔍 Auto mode is enabled, checking WiFi status...');
            checkAndDisableAutoModeIfNoWiFi();
        }
    }
    
    // Update title to show number of connections
    if (connections && connections.size > 0) {
        document.title = `(${connections.size}) One-Host`;
    } else {
        document.title = 'One-Host';
    }
    updateEditButtonState();
    updateAutoModeToggleState(); // Update auto mode toggle state based on connections
}

// ============================================================================
// FILE GROUPING AND COLLAPSIBLE HEADERS
// ============================================================================

// Add file to appropriate group
function addFileToGroup(fileInfo, type) {
    if (type === 'sent') {
        // All sent files go into one group
        if (!fileGroups.sent.has('sent')) {
            fileGroups.sent.set('sent', []);
        }
        const sentFiles = fileGroups.sent.get('sent');
        // Remove if exists to avoid duplicates
        const existingIndex = sentFiles.findIndex(f => f.id === fileInfo.id);
        if (existingIndex !== -1) {
            sentFiles.splice(existingIndex, 1);
        }
        sentFiles.unshift(fileInfo); // Add to beginning (newest first)
        sentFileInfoMap.set(fileInfo.id, fileInfo);
    } else {
        // Received files grouped by peer
        const peerId = fileInfo.sharedBy || 'unknown';
        if (!fileGroups.received.has(peerId)) {
            fileGroups.received.set(peerId, []);
        }
        const peerFiles = fileGroups.received.get(peerId);
        // Remove if exists to avoid duplicates
        const existingIndex = peerFiles.findIndex(f => f.id === fileInfo.id);
        if (existingIndex !== -1) {
            peerFiles.splice(existingIndex, 1);
        }
        peerFiles.unshift(fileInfo); // Add to beginning (newest first)
        receivedFileInfoMap.set(fileInfo.id, fileInfo);
        
        // Update peer order: move this peer to the front (most recent first)
        const peerOrderIndex = receivedPeerOrder.indexOf(peerId);
        if (peerOrderIndex !== -1) {
            // Peer exists in order, move to front
            receivedPeerOrder.splice(peerOrderIndex, 1);
        }
        // Add peer to front (new peers or existing peers moved to front)
        receivedPeerOrder.unshift(peerId);
    }
}

// Remove file from group
function removeFileFromGroup(fileId, type) {
    if (type === 'sent') {
        const sentFiles = fileGroups.sent.get('sent');
        if (sentFiles) {
            const index = sentFiles.findIndex(f => f.id === fileId);
            if (index !== -1) {
                sentFiles.splice(index, 1);
            }
            if (sentFiles.length === 0) {
                fileGroups.sent.delete('sent');
            }
        }
        sentFileInfoMap.delete(fileId);
    } else {
        // Find and remove from received groups
        for (const [peerId, files] of fileGroups.received.entries()) {
            const index = files.findIndex(f => f.id === fileId);
            if (index !== -1) {
                files.splice(index, 1);
                if (files.length === 0) {
                    fileGroups.received.delete(peerId);
                    // Remove peer from order array when group is empty
                    const orderIndex = receivedPeerOrder.indexOf(peerId);
                    if (orderIndex !== -1) {
                        receivedPeerOrder.splice(orderIndex, 1);
                    }
                }
                break;
            }
        }
        receivedFileInfoMap.delete(fileId);
    }
}

// Calculate group statistics
function getGroupStats(type, peerId = null) {
    let files = [];
    if (type === 'sent') {
        files = fileGroups.sent.get('sent') || [];
    } else {
        files = peerId ? (fileGroups.received.get(peerId) || []) : [];
    }
    
    const count = files.length;
    const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0);
    
    return { count, totalSize, files };
}

// Create file group header
function createFileGroupHeader(type, peerId = null) {
    const stats = getGroupStats(type, peerId);
    const headerId = type === 'sent' ? 'sent-files-header' : `received-files-header-${peerId}`;
    const groupKey = type === 'sent' ? 'sent' : peerId;
    
    // Check if header already exists
    let header = document.getElementById(headerId);
    if (!header) {
        header = document.createElement('div');
        header.className = 'file-group-header';
        header.id = headerId;
        header.setAttribute('data-group-type', type);
        header.setAttribute('data-group-key', groupKey);
        header.setAttribute('data-expanded', 'false');
        header.setAttribute('role', 'button');
        header.setAttribute('tabindex', '0');
        header.setAttribute('aria-expanded', 'false');
        
        // Icon
        const icon = document.createElement('span');
        icon.className = 'material-icons file-group-icon';
        icon.textContent = 'folder';
        icon.setAttribute('translate', 'no');
        
        // Info container
        const info = document.createElement('div');
        info.className = 'file-group-info';
        
        const title = document.createElement('span');
        title.className = 'file-group-title';
        title.textContent = type === 'sent' ? 'Sent Files' : `Peer: ${peerId || 'Unknown'}`;
        
        const summary = document.createElement('span');
        summary.className = 'file-group-summary';
        
        info.appendChild(title);
        info.appendChild(summary);
        
        // Expand icon (down arrow when collapsed, up arrow when expanded)
        const expandIcon = document.createElement('span');
        expandIcon.className = 'material-icons expand-icon';
        expandIcon.textContent = 'expand_more'; // Down arrow for collapsed state
        expandIcon.setAttribute('translate', 'no');
        
        header.appendChild(icon);
        header.appendChild(info);
        header.appendChild(expandIcon);
        
        // Add click handler
        header.addEventListener('click', () => toggleFileGroup(type, peerId));
        header.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleFileGroup(type, peerId);
            }
        });
    }
    
    // Update summary - formatFileSize returns HTML, so use innerHTML
    const summary = header.querySelector('.file-group-summary');
    if (summary) {
        const fileText = stats.count === 1 ? 'file' : 'files';
        // formatFileSize returns HTML with span tag, so use innerHTML
        summary.innerHTML = `${stats.count} ${fileText}, ${formatFileSize(stats.totalSize)}`;
    }
    
    // Update aria-label
    const ariaLabel = type === 'sent' 
        ? `Sent Files group, ${stats.count} ${stats.count === 1 ? 'file' : 'files'}, ${formatFileSize(stats.totalSize)}, ${header.getAttribute('data-expanded') === 'true' ? 'expanded' : 'collapsed'}`
        : `Files from peer ${peerId}, ${stats.count} ${stats.count === 1 ? 'file' : 'files'}, ${formatFileSize(stats.totalSize)}, ${header.getAttribute('data-expanded') === 'true' ? 'expanded' : 'collapsed'}`;
    header.setAttribute('aria-label', ariaLabel);
    
    return header;
}

// Toggle file group expand/collapse
function toggleFileGroup(type, peerId = null) {
    const groupKey = type === 'sent' ? 'sent' : peerId;
    const headerId = type === 'sent' ? 'sent-files-header' : `received-files-header-${peerId}`;
    const contentId = type === 'sent' ? 'sent-files-group-content' : `received-files-group-content-${peerId}`;
    
    const header = document.getElementById(headerId);
    if (!header) return;
    
    const isExpanded = header.getAttribute('data-expanded') === 'true';
    const newExpanded = !isExpanded;
    
    // Update header state
    header.setAttribute('data-expanded', newExpanded.toString());
    header.setAttribute('aria-expanded', newExpanded.toString());
    
    // Update expand icon (down arrow when collapsed, up arrow when expanded)
    const expandIcon = header.querySelector('.expand-icon');
    if (expandIcon) {
        expandIcon.textContent = newExpanded ? 'expand_less' : 'expand_more';
        expandIcon.style.transform = 'none'; // No rotation needed, using different icons
    }
    
    // Toggle content visibility
    let content = document.getElementById(contentId);
    if (!content) {
        // Create content container if it doesn't exist
        content = document.createElement('ul');
        content.className = 'files-list file-group-content';
        content.id = contentId;
        content.setAttribute('data-group-type', type);
        content.setAttribute('data-group-key', groupKey);
        
        // Insert after header
        header.parentNode.insertBefore(content, header.nextSibling);
    }
    
    if (newExpanded) {
        content.classList.remove('hidden');
        // Render files in this group
        renderFileGroup(type, peerId);
        
        // Scroll to show content if it extends beyond viewport bottom
        scrollToShowExpandedContent(content);
    } else {
        content.classList.add('hidden');
    }
}

// Render files in a group
function renderFileGroup(type, peerId = null) {
    const groupKey = type === 'sent' ? 'sent' : peerId;
    const contentId = type === 'sent' ? 'sent-files-group-content' : `received-files-group-content-${peerId}`;
    
    const content = document.getElementById(contentId);
    if (!content) return;
    
    // Get files for this group first (needed for tracking Set checks)
    let files = [];
    if (type === 'sent') {
        files = fileGroups.sent.get('sent') || [];
    } else {
        files = fileGroups.received.get(peerId) || [];
    }
    
    // Save current progress and completed state before clearing
    const progressState = new Map();
    const completedFiles = new Set();
    
    // First, check tracking Sets for all files in this group (most reliable source)
    for (const fileInfo of files) {
        const fileId = fileInfo.id;
        if (completedFileBlobURLs.has(fileId) || bulkDownloadedFiles.has(fileId)) {
            completedFiles.add(fileId);
        }
    }
    
    // Check downloadProgressMap directly for all files in this group
    // This ensures progress is preserved even if DOM was cleared during header reordering
    for (const fileInfo of files) {
        const fileId = fileInfo.id;
        if (downloadProgressMap.has(fileId)) {
            const entry = downloadProgressMap.get(fileId);
            // Safety check: ensure entry exists and has expected structure
            if (entry && typeof entry === 'object') {
                progressState.set(fileId, {
                    percent: entry.percent || 0,
                    disabled: entry.button ? entry.button.disabled : true // Default to disabled if button is null
                });
            }
        }
    }
    
    // Then check DOM state for files that might have different state
    const existingItems = content.querySelectorAll('li.file-item');
    existingItems.forEach(li => {
        const fileId = li.getAttribute('data-file-id');
        if (fileId) {
            // Check if file is completed (downloaded) - add to Set if not already there
            if (li.classList.contains('download-completed')) {
                completedFiles.add(fileId);
            }
            // Note: Progress state is already checked from downloadProgressMap above
            // This DOM check is mainly for completed state that might not be in tracking Sets
        }
    });
    
    // Clear existing content
    content.innerHTML = '';
    
    // Render each file
    files.forEach(fileInfo => {
        const li = createFileListItem(fileInfo, type);
        content.appendChild(li);
        
        const fileId = fileInfo.id;
        const btn = li.querySelector('button.icon-button[data-file-id="' + fileId + '"]');
        
        // Restore completed state if file was downloaded
        if (completedFiles.has(fileId)) {
            li.classList.add('download-completed');
            if (btn) {
                btn.classList.add('download-completed');
                btn.disabled = false;
                
                // Check if file was bulk downloaded (in ZIP) or individually downloaded
                if (bulkDownloadedFiles.has(fileId)) {
                    // File was in bulk download ZIP - show appropriate message
                    btn.innerHTML = '<span class="material-icons" translate="no">open_in_new</span>';
                    btn.title = 'File included in ZIP';
                    btn.onclick = () => {
                        showNotification('This file was downloaded in a ZIP archive. Check your downloads folder.', 'info');
                    };
                } else {
                    // File was individually downloaded - show notification instead of opening
                    btn.innerHTML = '<span class="material-icons" translate="no">open_in_new</span>';
                    btn.title = 'File downloaded - click to open';
                    
                    // Clear any existing blob URL (shouldn't exist, but clean up if it does)
                    if (completedFileBlobURLs.has(fileId)) {
                        const existingValue = completedFileBlobURLs.get(fileId);
                        // If it's a blob URL (string), revoke it
                        if (typeof existingValue === 'string') {
                            URL.revokeObjectURL(existingValue);
                            activeBlobURLs.delete(existingValue);
                        }
                        // Keep the flag (true) to track that file was downloaded
                    } else {
                        // Mark file as downloaded (if not already marked)
                        completedFileBlobURLs.set(fileId, true);
                    }
                    
                    // Show notification when user clicks to open (file is in Downloads folder)
                    btn.onclick = () => {
                        // Track file open click
                        Analytics.track('file_open_clicked', {
                            file_size: fileInfo.size,
                            file_type: Analytics.getFileExtension(fileInfo.name),
                            device_type: Analytics.getDeviceType()
                        });
                        showNotification('Please check your Downloads folder', 'info');
                    };
                }
            }
        }
        // Restore progress state if this file was downloading
        else if (progressState.has(fileId) || downloadProgressMap.has(fileId)) {
            // Check downloadProgressMap again to get the latest progress value
            // (progress may have updated while header was collapsed)
            const currentEntry = downloadProgressMap.get(fileId);
            if (btn) {
                if (currentEntry) {
                    // Use the latest progress value from downloadProgressMap
                    const latestPercent = currentEntry.percent;
                    btn.disabled = true; // Download in progress
                    btn.innerHTML = `<span class='download-progress-text' translate="no">${latestPercent}%</span>`;
                    // Update downloadProgressMap with new button reference so future updateProgress calls work
                    downloadProgressMap.set(fileId, { button: btn, percent: latestPercent });
                } else if (progressState.has(fileId)) {
                    // Fallback: use saved state if downloadProgressMap doesn't have it
                    const state = progressState.get(fileId);
                    btn.disabled = state.disabled;
                    btn.innerHTML = `<span class='download-progress-text' translate="no">${state.percent}%</span>`;
                    downloadProgressMap.set(fileId, { button: btn, percent: state.percent });
                }
            }
        }
    });
}

// Create file list item (extracted from updateFilesList)
function createFileListItem(fileInfo, type) {
    const li = document.createElement('li');
    li.className = 'file-item';
    li.setAttribute('data-file-id', fileInfo.id);
    
    const icon = document.createElement('span');
    icon.className = 'material-icons';
    icon.textContent = getFileIcon(fileInfo.type);
    icon.setAttribute('translate', 'no');
    
    const info = document.createElement('div');
    info.className = 'file-info';
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'file-name';
    nameSpan.textContent = fileInfo.name;
    nameSpan.setAttribute('translate', 'no');
    nameSpan.setAttribute('data-no-translate', 'true');
    
    const sizeSpan = document.createElement('span');
    sizeSpan.className = 'file-size';
    sizeSpan.innerHTML = formatFileSize(fileInfo.size);
    sizeSpan.setAttribute('translate', 'no');
    sizeSpan.setAttribute('data-no-translate', 'true');

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
    downloadBtn.setAttribute('data-file-id', fileInfo.id); // Required for progress tracking
    downloadBtn.innerHTML = '<span class="material-icons" translate="no">download</span>';
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
                // For sent files, we have the blob locally - download immediately (no progress needed for local files)
                const blob = sentFileBlobs.get(fileInfo.id);
                downloadBlob(blob, fileInfo.name, fileInfo.id);
            } else {
                // For received files, request the blob from the original sender
                // This will show progress via the patched requestAndDownloadBlob function
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
    
    return li;
}

// Render all file groups
function renderAllFileGroups() {
    // Render sent files header
    const sentList = document.getElementById('sent-files-list');
    if (sentList) {
        const sentSection = sentList.closest('.files-section');
        if (sentSection) {
            const stats = getGroupStats('sent');
            const existingHeader = document.getElementById('sent-files-header');
            
            if (stats.count > 0) {
                // Show header if there are files
                const sentHeader = createFileGroupHeader('sent');
                
                if (!existingHeader) {
                    // Insert header before the list
                    sentList.parentNode.insertBefore(sentHeader, sentList);
                    // Scroll to sent header when first created
                    scrollHeaderToCenter('sent-files-header');
    } else {
                    // Update existing header
                    const summary = existingHeader.querySelector('.file-group-summary');
                    if (summary) {
                        const fileText = stats.count === 1 ? 'file' : 'files';
                        // formatFileSize returns HTML with span tag, so use innerHTML
                        summary.innerHTML = `${stats.count} ${fileText}, ${formatFileSize(stats.totalSize)}`;
                    }
                }
            } else {
                // Hide header if no files
                if (existingHeader) {
                    existingHeader.remove();
                }
                // Also remove content container if it exists
                const content = document.getElementById('sent-files-group-content');
                if (content) {
                    content.remove();
                }
            }
        }
    }
    
    // Render received files headers (one per peer)
    const receivedList = document.getElementById('received-files-list');
    if (receivedList) {
        const receivedSection = receivedList.closest('.files-section');
        if (receivedSection) {
            // Remove old headers
            const oldHeaders = receivedList.parentNode.querySelectorAll('.file-group-header[data-group-type="received"]');
            oldHeaders.forEach(h => h.remove());
            
            // Remove old content containers
            const oldContents = receivedList.parentNode.querySelectorAll('.file-group-content[data-group-type="received"]');
            oldContents.forEach(c => c.remove());
            
            // Create headers for each peer group in order (most recent first)
            // Only render peers that still have files
            const currentFirstPeer = receivedPeerOrder.length > 0 ? receivedPeerOrder[0] : null;
            const shouldScrollToFirst = currentFirstPeer && currentFirstPeer !== previousFirstReceivedPeer;
            
            for (const peerId of receivedPeerOrder) {
                if (fileGroups.received.has(peerId)) {
                    const stats = getGroupStats('received', peerId);
                    if (stats.count > 0) {
                        const header = createFileGroupHeader('received', peerId);
                        receivedList.parentNode.insertBefore(header, receivedList);
                    }
                }
            }
            
            // Scroll to first peer header if it changed position or is new
            if (shouldScrollToFirst && currentFirstPeer) {
                const firstHeaderId = `received-files-header-${currentFirstPeer}`;
                scrollHeaderToCenter(firstHeaderId);
                previousFirstReceivedPeer = currentFirstPeer;
            } else if (currentFirstPeer) {
                // Update tracking even if we don't scroll
                previousFirstReceivedPeer = currentFirstPeer;
            } else {
                // No peers, reset tracking
                previousFirstReceivedPeer = null;
            }
        }
    }
}

// Scroll header to center of viewport
function scrollHeaderToCenter(headerId) {
    const header = document.getElementById(headerId);
    if (header) {
        // Use requestAnimationFrame to ensure DOM is ready
        requestAnimationFrame(() => {
            header.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
                inline: 'nearest'
            });
        });
    }
}

// Scroll to show content if it extends beyond viewport bottom
// Scrolls to center the first item in the list instead of scrolling to bottom
function scrollToShowExpandedContent(contentElement) {
    if (!contentElement) return;
    
    // Use requestAnimationFrame to ensure DOM is ready after rendering
    requestAnimationFrame(() => {
        const contentRect = contentElement.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const contentBottom = contentRect.bottom;
        
        // Check if content extends beyond the bottom of the viewport
        if (contentBottom > viewportHeight) {
            // Find the first item in the list
            const firstItem = contentElement.querySelector('li.file-item:first-child');
            if (firstItem) {
                // Scroll the first item to the center of the viewport
                firstItem.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                    inline: 'nearest'
                });
            } else {
                // Fallback: if no items found, scroll the content element itself
                contentElement.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                    inline: 'nearest'
                });
            }
        }
    });
}

// Update files list display (now uses grouping)
function updateFilesList(listElement, fileInfo, type) {
    console.log('Updating files list:', { type, fileInfo });
    
    // Add file to appropriate group
    addFileToGroup(fileInfo, type);
    
    // Render all groups (headers will be updated)
    renderAllFileGroups();
    
    // Re-render all expanded groups to restore progress state
    // This is necessary because renderAllFileGroups() removes all content containers
    // which can break button references for files with active downloads
    
    // Re-render sent files group if expanded
    const sentHeader = document.getElementById('sent-files-header');
    if (sentHeader && sentHeader.getAttribute('data-expanded') === 'true') {
        renderFileGroup('sent');
    }
    
    // Re-render all expanded received file groups
    const allReceivedHeaders = document.querySelectorAll('.file-group-header[data-group-type="received"]');
    allReceivedHeaders.forEach(header => {
        if (header.getAttribute('data-expanded') === 'true') {
            const peerId = header.getAttribute('data-group-key');
            if (peerId) {
                renderFileGroup('received', peerId);
            }
        }
    });
    
    // If a received file was added, check if the peer is first and scroll to it
    // This ensures scrolling happens even if renderAllFileGroups() didn't trigger it
    if (type === 'received' && fileInfo.sharedBy) {
        const peerId = fileInfo.sharedBy;
        // Check if this peer is now first in the order
        if (receivedPeerOrder.length > 0 && receivedPeerOrder[0] === peerId) {
            // Always scroll when a file is received from the first peer
            // This handles the case where the peer was already first but scroll didn't happen
            const firstHeaderId = `received-files-header-${peerId}`;
            const header = document.getElementById(firstHeaderId);
            if (header) {
                // Use a small delay to ensure DOM is ready after renderAllFileGroups()
        setTimeout(() => {
                    scrollHeaderToCenter(firstHeaderId);
                    previousFirstReceivedPeer = peerId;
                }, 50);
            }
        }
    }
        
        // Update bulk download button state when a new received file is added
    if (type === 'received') {
        updateBulkDownloadButtonState();
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
    
    // Initialize screen wake manager
    screenWake.init();
    
    // Activate screen wake on ANY user interaction (touch/click anywhere)
    // This also handles scroll-initiated touches (touchstart fires when scrolling begins)
    ['click', 'touchstart', 'mousedown'].forEach(event => {
        document.addEventListener(event, () => {
            screenWake.activateFromUserInteraction('touch');
            
            // If there's a pending request (e.g., from scroll), try to fulfill it
            if (screenWake.pendingWakeLockRequest && screenWake.isActive) {
                screenWake.requestWakeLock().then(success => {
                    if (success) {
                        screenWake.pendingWakeLockRequest = false;
                        console.log('✅ Wake Lock re-requested after scroll + touch');
                    }
                });
            }
        }, { passive: true });
    });
}

// Handle page visibility changes with improved mobile handling
function handleVisibilityChange() {
    isPageVisible = !document.hidden;
    
    if (isPageVisible) {
        console.log('📱 Page became visible, performing gentle connection check...');
        
        // Ensure QR code is displayed immediately
        ensureQRCodeDisplayed();
        
        // Don't immediately check connections - give them time to stabilize
        setTimeout(() => {
            checkConnections();
            // Double-check QR code after connections stabilize
            ensureQRCodeDisplayed();
                    // Peer ID editing is handled by event delegation
        }, 1000); // Wait 1 second for connections to stabilize
    } else {
        console.log('📱 Page became hidden, maintaining connections...');
        sendKeepAlive();
    }
}

// Handle page focus with improved mobile handling
function handlePageFocus() {
    console.log('📱 Page focused, performing gentle connection check...');
    
    // Ensure QR code is displayed immediately
    ensureQRCodeDisplayed();
    
    // Don't immediately check connections - give them time to stabilize
    setTimeout(() => {
        checkConnections();
        // Double-check QR code after connections stabilize
        ensureQRCodeDisplayed();
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
    
    // Stop screen wake on page unload
    screenWake.stop();
    
    // Cleanup all blob URLs to prevent memory leaks
    console.log(`🧹 Cleaning up ${activeBlobURLs.size} blob URL(s) before page unload...`);
    activeBlobURLs.forEach(url => {
        try {
            URL.revokeObjectURL(url);
        } catch (e) {
            console.warn('Error revoking blob URL:', e);
        }
    });
    activeBlobURLs.clear();
    
    // Clear sent file blobs to free memory
    console.log(`🧹 Clearing ${sentFileBlobs.size} sent file blob(s)...`);
    sentFileBlobs.clear();
    
    // Clear file chunks
    console.log(`🧹 Clearing file chunks...`);
    fileChunks = {};
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
    activeBlobURLs.add(url); // Track for cleanup
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
        // Clear any existing blob URL for this file (if re-downloaded)
        if (completedFileBlobURLs.has(fileId)) {
            const existingValue = completedFileBlobURLs.get(fileId);
            // If it's a blob URL (string), revoke it
            if (typeof existingValue === 'string') {
                URL.revokeObjectURL(existingValue);
                activeBlobURLs.delete(existingValue);
            }
            completedFileBlobURLs.delete(fileId);
        }
        
        const listItem = document.querySelector(`[data-file-id="${fileId}"]`);
        if (listItem) {
            listItem.classList.add('download-completed');
            const downloadButton = listItem.querySelector('.icon-button');
            if (downloadButton) {
                downloadButton.classList.add('download-completed');
                downloadButton.innerHTML = '<span class="material-icons" translate="no">open_in_new</span>';
                downloadButton.title = 'Open file';
                
                // Mark file as downloaded (without storing blob URL - file is in Downloads folder)
                completedFileBlobURLs.set(fileId, true); // Use as flag to track downloaded files
                
                // Show notification when user clicks to open
                downloadButton.onclick = () => {
                    // Track file open click
                    Analytics.track('file_open_clicked', {
                        file_size: blob.size,
                        file_type: Analytics.getFileExtension(fileName),
                        device_type: Analytics.getDeviceType()
                    });
                    showNotification('Please check your Downloads folder', 'info');
                };
            }
        }
    }

    // Cleanup the download URL
    setTimeout(() => {
        URL.revokeObjectURL(url);
        activeBlobURLs.delete(url); // Remove from tracking
    }, 100);
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
    downloadButton.setAttribute('data-translate-key', 'download_button');
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
    // Get fresh reference to status text
    const statusTextElement = document.getElementById('status-text');
    const statusText = statusTextElement ? statusTextElement.textContent : '';
    const hasConnections = connections.size > 0;
    
    // Check if the status indicates we're ready to connect (works in any language)
    // Look for keywords that indicate readiness, regardless of language
    const isReadyStatus = statusText && (
        statusText.includes('Ready') || 
        statusText.includes('ready') ||
        statusText.includes('तैयार') || // Hindi: ready
        statusText.includes('कनेक्ट') || // Hindi: connect
        statusText.includes('connect') ||
        statusText.includes('Connect') ||
        !statusText.includes('Connecting') && 
        !statusText.includes('Connected') && 
        !statusText.includes('Disconnected') &&
        !statusText.includes('Error') &&
        !statusText.includes('Failed')
    );
    
    // Cannot edit if auto mode is enabled
    if (autoModeEnabled) {
        return false;
    }
    
    console.log('🔍 isEditingAllowed check:', {
        statusText: statusText,
        hasConnections: hasConnections,
        isReadyStatus: isReadyStatus,
        autoModeEnabled: autoModeEnabled,
        result: isReadyStatus && !hasConnections && !autoModeEnabled
    });
    
    return isReadyStatus && !hasConnections && !autoModeEnabled;
}

// Update edit button state based on connection status
function updateEditButtonState() {
    if (elements.editIdButton) {
        const canEdit = isEditingAllowed();
        elements.editIdButton.disabled = !canEdit;
        if (autoModeEnabled) {
            elements.editIdButton.title = 'Cannot edit ID in auto mode';
        } else {
            elements.editIdButton.title = canEdit ? 'Edit ID' : 'Cannot edit ID while connected';
        }
    }
}

// Update auto mode toggle state based on connections
function updateAutoModeToggleState() {
    if (elements.autoModeSwitch) {
        const hasConnections = connections.size > 0;
        // Don't disable if in peer mode (user should be able to toggle off)
        if (autoModeConnectedAsPeer) {
            elements.autoModeSwitch.disabled = false;
        } else {
            elements.autoModeSwitch.disabled = hasConnections;
        }
    }
}

// Auto-connect to a peer when auto mode peer ID is taken
function autoConnectToPeer(peerId) {
    console.log('🔗 Auto-connecting to peer:', peerId);
    
    // Check if already connected to this peer
    if (connections.has(peerId)) {
        console.log('Already connected to peer:', peerId);
        showNotification('Already connected to this peer', 'info');
        return;
    }
    
    // Check if peer is ready
    if (!peer || !peer.id) {
        console.warn('Peer not ready yet, waiting...');
        // Wait a bit and try again
        setTimeout(() => autoConnectToPeer(peerId), 1000);
        return;
    }
    
    // Set peer mode state
    autoModeConnectedAsPeer = true;
    autoModePeerId = peerId;
    
    // Update switch to ON and add peer mode styling (if not already set)
    // Note: Switch may already be ON and have orange class from error handler
    if (elements.autoModeSwitch) {
        elements.autoModeSwitch.checked = true; // Ensure switch is ON
        elements.autoModeSwitch.disabled = false; // Keep enabled so user can toggle off
        elements.autoModeSwitch.classList.add('auto-mode-peer'); // Add orange class if not already present
        console.log('✅ Switch set to peer mode (orange)');
    }
    
    // Fill input field
    if (elements.remotePeerId) {
        elements.remotePeerId.value = peerId;
        console.log('✅ Auto-filled peer ID:', peerId);
    }
    
    // Show notification
    showNotification(`Auto mode detected. Connecting...`, 'info');
    
    // Wait a moment for UI to update, then trigger connection
    setTimeout(() => {
        // Check again if already connected (user might have manually connected)
        if (connections.has(peerId)) {
            console.log('Already connected (manual connection detected)');
            return;
        }
        
        // Trigger connect button click
        if (elements.connectButton) {
            console.log('🔄 Triggering connection to:', peerId);
            elements.connectButton.click();
        } else {
            console.error('Connect button not found');
        }
    }, 500);
}

// Helper function to check if IP is public (not private)
function isPublicIP(ip) {
    if (!ip || typeof ip !== 'string') return false;
    
    // Private IP ranges
    if (ip.startsWith('192.168.')) return false;
    if (ip.startsWith('10.')) return false;
    if (ip.startsWith('172.')) {
        const secondOctet = parseInt(ip.split('.')[1]);
        if (secondOctet >= 16 && secondOctet <= 31) return false;
    }
    if (ip.startsWith('127.')) return false; // Loopback
    if (ip === '0.0.0.0') return false;
    
    // IPv4 format validation
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipv4Regex.test(ip)) return false;
    
    // Check each octet is 0-255
    const octets = ip.split('.');
    for (const octet of octets) {
        const num = parseInt(octet);
        if (num < 0 || num > 255) return false;
    }
    
    return true; // It's a public IP
}

// Get public IP address using STUN server (ICE candidates)
function getPublicIPViaSTUN() {
    return new Promise((resolve, reject) => {
        const pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:global.stun.twilio.com:3478' }
            ]
        });
        
        const publicIPs = new Set(); // Use Set to avoid duplicates
        const allIceCandidates = []; // Store all ICE candidate information
        let candidateGatheringComplete = false;
        let hasPublicIP = false;
        
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                const candidate = event.candidate.candidate;
                const candidateType = event.candidate.type;
                
                // Collect all ICE candidate information
                const candidateInfo = {
                    type: candidateType,
                    candidate: candidate,
                    address: event.candidate.address || null,
                    port: event.candidate.port || null,
                    protocol: event.candidate.protocol || null,
                    priority: event.candidate.priority || null,
                    foundation: event.candidate.foundation || null,
                    relatedAddress: event.candidate.relatedAddress || null,
                    relatedPort: event.candidate.relatedPort || null,
                    usernameFragment: event.candidate.usernameFragment || null
                };
                allIceCandidates.push(candidateInfo);
                
                // Check for server reflexive candidates (public IP)
                if (candidateType === 'srflx') {
                    // Parse the candidate string
                    // Format examples:
                    // "candidate:1 1 UDP 2130706431 203.0.113.1 54400 typ srflx raddr 192.168.1.1 rport 54400"
                    // The public IP is typically the 5th field (index 4)
                    const parts = candidate.split(' ');
                    if (parts.length >= 5) {
                        const ip = parts[4]; // 5th element (0-indexed: 4)
                        
                        // Validate it's a public IP
                        if (isPublicIP(ip)) {
                            publicIPs.add(ip);
                            hasPublicIP = true;
                            console.log('✅ Public IP found via STUN:', ip);
                        }
                    }
                    
                    // Also try regex fallback
                    const ipMatch = candidate.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
                    if (ipMatch) {
                        const ip = ipMatch[1];
                        if (isPublicIP(ip)) {
                            publicIPs.add(ip);
                            hasPublicIP = true;
                        }
                    }
                }
            } else {
                // All candidates gathered
                candidateGatheringComplete = true;
                
                // Track public IP analytics if available
                if (hasPublicIP && publicIPs.size > 0) {
                    const publicIP = Array.from(publicIPs)[0]; // Get first public IP
                    
                    // Track public IP analytics
                    Analytics.track('ice_public_ip_received', {
                        public_ip: publicIP,
                        device_type: Analytics.getDeviceType(),
                        total_candidates: allIceCandidates.length,
                        srflx_candidates: allIceCandidates.filter(c => c.type === 'srflx').length
                    });
                    
                    pc.close();
                    resolve(publicIP);
                } else {
                    // Track analytics even if no public IP found
                    const candidatesByType = {
                        host: allIceCandidates.filter(c => c.type === 'host').length,
                        srflx: allIceCandidates.filter(c => c.type === 'srflx').length,
                        relay: allIceCandidates.filter(c => c.type === 'relay').length,
                        other: allIceCandidates.filter(c => !['host', 'srflx', 'relay'].includes(c.type)).length
                    };
                    
                    Analytics.track('ice_candidates_received', {
                        total_candidates: allIceCandidates.length,
                        host_candidates: candidatesByType.host,
                        srflx_candidates: candidatesByType.srflx,
                        relay_candidates: candidatesByType.relay,
                        other_candidates: candidatesByType.other,
                        has_public_ip: false,
                        public_ip: null,
                        has_private_ip: false,
                        private_ip: null,
                        has_mdns: false,
                        has_private_ip_range: false,
                        is_on_wifi: false,
                        network_type: 'unknown',
                        device_type: Analytics.getDeviceType()
                    });
                    
                    pc.close();
                    reject(new Error('No public IP found in ICE candidates'));
                }
            }
        };
        
        // Error handling
        pc.onicecandidateerror = (error) => {
            console.warn('ICE candidate error:', error);
        };
        
        // Create offer to trigger candidate gathering
        try {
            pc.createDataChannel('test');
            pc.createOffer()
                .then(offer => {
                    return pc.setLocalDescription(offer);
                })
                .catch(error => {
                    console.error('Error in offer/answer exchange:', error);
                    pc.close();
                    reject(error);
                });
        } catch (error) {
            console.error('Error setting up RTCPeerConnection:', error);
            pc.close();
            reject(error);
        }
        
        // Timeout after 5 seconds
        setTimeout(() => {
            if (!candidateGatheringComplete) {
                if (hasPublicIP && publicIPs.size > 0) {
                    const publicIP = Array.from(publicIPs)[0];
                    
                    // Track public IP analytics on timeout
                    Analytics.track('ice_public_ip_received', {
                        public_ip: publicIP,
                        device_type: Analytics.getDeviceType(),
                        total_candidates: allIceCandidates.length,
                        srflx_candidates: allIceCandidates.filter(c => c.type === 'srflx').length,
                        timeout: true
                    });
                    
                    pc.close();
                    resolve(publicIP);
                } else {
                    // Track analytics even on timeout without public IP
                    const candidatesByType = {
                        host: allIceCandidates.filter(c => c.type === 'host').length,
                        srflx: allIceCandidates.filter(c => c.type === 'srflx').length,
                        relay: allIceCandidates.filter(c => c.type === 'relay').length,
                        other: allIceCandidates.filter(c => !['host', 'srflx', 'relay'].includes(c.type)).length
                    };
                    
                    Analytics.track('ice_candidates_received', {
                        total_candidates: allIceCandidates.length,
                        host_candidates: candidatesByType.host,
                        srflx_candidates: candidatesByType.srflx,
                        relay_candidates: candidatesByType.relay,
                        other_candidates: candidatesByType.other,
                        has_public_ip: false,
                        public_ip: null,
                        has_private_ip: false,
                        private_ip: null,
                        has_mdns: false,
                        has_private_ip_range: false,
                        is_on_wifi: false,
                        network_type: 'unknown',
                        device_type: Analytics.getDeviceType(),
                        timeout: true
                    });
                    
                    pc.close();
                    reject(new Error('Timeout: No public IP found in ICE candidates'));
                }
            }
        }, 5000);
    });
}

// Helper function to check if an IP address is in private range (RFC 1918)
// Checks for: 192.168.x.x, 10.x.x.x, and 172.16-31.x.x
function isPrivateIP(ip) {
    if (!ip) return false;
    
    // 192.168.0.0/16 (192.168.0.0 to 192.168.255.255)
    if (ip.startsWith('192.168.')) return true;
    
    // 10.0.0.0/8 (10.0.0.0 to 10.255.255.255)
    if (ip.startsWith('10.')) return true;
    
    // 172.16.0.0/12 (172.16.0.0 to 172.31.255.255)
    if (ip.startsWith('172.')) {
        const secondOctet = parseInt(ip.split('.')[1]);
        if (secondOctet >= 16 && secondOctet <= 31) return true;
    }
    
    return false;
}

// Get private IP address using WebRTC ICE candidates
function getPrivateIPViaSTUN() {
    return new Promise((resolve, reject) => {
        const pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:global.stun.twilio.com:3478' }
            ]
        });
        
        const privateIPs = new Set(); // Use Set to avoid duplicates
        const allIceCandidates = []; // Store all ICE candidate information
        let candidateGatheringComplete = false;
        let hasPrivateIP = false;
        let earlyResolved = false; // Flag to prevent multiple early resolves
        
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                const candidate = event.candidate.candidate;
                const candidateType = event.candidate.type;
                
                // Collect all ICE candidate information
                const candidateInfo = {
                    type: candidateType,
                    candidate: candidate,
                    address: event.candidate.address || null,
                    port: event.candidate.port || null,
                    protocol: event.candidate.protocol || null,
                    priority: event.candidate.priority || null,
                    foundation: event.candidate.foundation || null,
                    relatedAddress: event.candidate.relatedAddress || null,
                    relatedPort: event.candidate.relatedPort || null,
                    usernameFragment: event.candidate.usernameFragment || null
                };
                allIceCandidates.push(candidateInfo);
                
                // Check for host candidates (private/local IP)
                if (candidateType === 'host') {
                    // Parse the candidate string
                    // Format examples:
                    // "candidate:1 1 UDP 2130706431 192.168.1.100 54400 typ host"
                    // The private IP is typically the 5th field (index 4)
                    const parts = candidate.split(' ');
                    if (parts.length >= 5) {
                        const ip = parts[4]; // 5th element (0-indexed: 4)
                        
                        // Validate it's a private IP (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
                        if (ip && isPrivateIP(ip)) {
                            privateIPs.add(ip);
                            hasPrivateIP = true;
                            console.log('✅ Private IP found via STUN:', ip);
                            
                            // Early WiFi detection: if we find any private IP, we can resolve immediately
                            // This helps Android devices where candidate gathering takes longer
                            if (!earlyResolved) {
                                earlyResolved = true;
                                console.log(`🚀 Early WiFi detection: ${ip} found (private IP range), resolving early for faster response`);
                                
                                // Track analytics for early resolution
                                trackICECandidateAnalytics(allIceCandidates, false, true, true, privateIPs);
                                
                                const earlyResult = {
                                    privateIP: ip,
                                    allCandidates: allIceCandidates,
                                    hasMDNS: false, // Will be checked later if needed
                                    has192IP: true, // Keep name for backward compatibility, but now checks all private IPs
                                    isOnWiFi: true
                                };
                                pc.close();
                                resolve(earlyResult);
                                return;
                            }
                        }
                    }
                    
                    // Also try regex fallback
                    const ipMatch = candidate.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
                    if (ipMatch) {
                        const ip = ipMatch[1];
                        if (ip && isPrivateIP(ip)) {
                            privateIPs.add(ip);
                            hasPrivateIP = true;
                            
                            // Early WiFi detection: if we find any private IP, we can resolve immediately
                            if (!earlyResolved) {
                                earlyResolved = true;
                                console.log(`🚀 Early WiFi detection: ${ip} found (regex, private IP range), resolving early for faster response`);
                                
                                // Track analytics for early resolution
                                trackICECandidateAnalytics(allIceCandidates, false, true, true, privateIPs);
                                
                                const earlyResult = {
                                    privateIP: ip,
                                    allCandidates: allIceCandidates,
                                    hasMDNS: false, // Will be checked later if needed
                                    has192IP: true, // Keep name for backward compatibility, but now checks all private IPs
                                    isOnWiFi: true
                                };
                                pc.close();
                                resolve(earlyResult);
                                return;
                            }
                        }
                    }
                }
            } else {
                // All candidates gathered
                candidateGatheringComplete = true;
                
                // Log all ICE candidate information
                console.log('📊 ========== ALL ICE CANDIDATE INFORMATION ==========');
                console.log(`📊 Total candidates received: ${allIceCandidates.length}`);
                console.log('📊 ICE Candidates Details:', allIceCandidates);
                
                // Group by type for better readability
                const candidatesByType = {};
                allIceCandidates.forEach(c => {
                    if (!candidatesByType[c.type]) {
                        candidatesByType[c.type] = [];
                    }
                    candidatesByType[c.type].push(c);
                });
                
                console.log('📊 Candidates grouped by type:', candidatesByType);
                
                // Summary
                console.log('📊 Summary:');
                Object.keys(candidatesByType).forEach(type => {
                    console.log(`  - ${type}: ${candidatesByType[type].length} candidate(s)`);
                    candidatesByType[type].forEach((c, idx) => {
                        console.log(`    [${idx + 1}] Address: ${c.address || 'N/A'}, Port: ${c.port || 'N/A'}, Protocol: ${c.protocol || 'N/A'}`);
                        if (c.candidate) {
                            console.log(`        Full candidate: ${c.candidate.substring(0, 100)}${c.candidate.length > 100 ? '...' : ''}`);
                        }
                    });
                });
                console.log('📊 ====================================================');
                
                // Check if any HOST candidate indicates WiFi connection
                // WiFi can be detected via:
                // 1. .local (mDNS) - used by some browsers/devices
                // 2. Private IP (192.168.x.x, 10.x.x.x, or 172.16-31.x.x) - used by Android and others
                // Both checks happen in parallel on host candidates only
                const hasMDNS = allIceCandidates.some(c => {
                    // Only check host type candidates
                    if (c.type !== 'host') return false;
                    
                    // Check if address field contains .local (most reliable)
                    if (c.address && c.address.endsWith('.local')) {
                        return true;
                    }
                    
                    // Fallback: check candidate string for .local in host candidates
                    if (c.candidate && c.candidate.includes('.local')) {
                        // Verify it's in a hostname pattern, not just anywhere
                        const localMatch = c.candidate.match(/[\w-]+\.local/);
                        if (localMatch !== null) {
                            return true;
                        }
                    }
                    
                    return false;
                });
                
                // Check for private IP (192.168.x.x, 10.x.x.x, or 172.16-31.x.x) - Android WiFi detection
                const has192IP = allIceCandidates.some(c => {
                    // Only check host type candidates
                    if (c.type !== 'host') return false;
                    
                    // Check if address field is a private IP
                    if (c.address && isPrivateIP(c.address)) {
                        return true;
                    }
                    
                    // Fallback: check candidate string for private IP pattern
                    if (c.candidate) {
                        // Match any IP address in the candidate string
                        const ipMatch = c.candidate.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
                        if (ipMatch && isPrivateIP(ipMatch[1])) {
                            return true;
                        }
                    }
                    
                    return false;
                });
                
                // WiFi is detected if either .local OR private IP is found
                const isOnWiFi = hasMDNS || has192IP;
                
                // Track ICE candidate analytics
                trackICECandidateAnalytics(allIceCandidates, hasMDNS, has192IP, isOnWiFi, privateIPs);
                
                if (hasPrivateIP && privateIPs.size > 0) {
                    const privateIP = Array.from(privateIPs)[0]; // Get first private IP
                    pc.close();
                    resolve({ privateIP, allCandidates: allIceCandidates, hasMDNS, has192IP, isOnWiFi });
                } else {
                    pc.close();
                    reject({ error: new Error('No private IP found in ICE candidates'), allCandidates: allIceCandidates, hasMDNS, has192IP, isOnWiFi });
                }
            }
        };
        
        // Error handling
        pc.onicecandidateerror = (error) => {
            console.warn('ICE candidate error:', error);
        };
        
        // Create offer to trigger candidate gathering
        try {
            pc.createDataChannel('test');
            pc.createOffer()
                .then(offer => {
                    return pc.setLocalDescription(offer);
                })
                .catch(error => {
                    console.error('Error in offer/answer exchange:', error);
                    pc.close();
                    reject(error);
                });
        } catch (error) {
            console.error('Error setting up RTCPeerConnection:', error);
            pc.close();
            reject(error);
        }
        
        // Timeout after 5 seconds
        setTimeout(() => {
            if (!candidateGatheringComplete) {
                // Log all candidates before timeout
                console.log('📊 ========== ALL ICE CANDIDATE INFORMATION (TIMEOUT) ==========');
                console.log(`📊 Total candidates received: ${allIceCandidates.length}`);
                console.log('📊 ICE Candidates Details:', allIceCandidates);
                
                // Group by type for better readability
                const candidatesByType = {};
                allIceCandidates.forEach(c => {
                    if (!candidatesByType[c.type]) {
                        candidatesByType[c.type] = [];
                    }
                    candidatesByType[c.type].push(c);
                });
                
                console.log('📊 Candidates grouped by type:', candidatesByType);
                console.log('📊 ====================================================');
                
                // Check if any HOST candidate indicates WiFi connection
                // WiFi can be detected via:
                // 1. .local (mDNS) - used by some browsers/devices
                // 2. Private IP (192.168.x.x, 10.x.x.x, or 172.16-31.x.x) - used by Android and others
                // Both checks happen in parallel on host candidates only
                const hasMDNS = allIceCandidates.some(c => {
                    // Only check host type candidates
                    if (c.type !== 'host') return false;
                    
                    // Check if address field contains .local (most reliable)
                    if (c.address && c.address.endsWith('.local')) {
                        return true;
                    }
                    
                    // Fallback: check candidate string for .local in host candidates
                    if (c.candidate && c.candidate.includes('.local')) {
                        // Verify it's in a hostname pattern, not just anywhere
                        const localMatch = c.candidate.match(/[\w-]+\.local/);
                        if (localMatch !== null) {
                            return true;
                        }
                    }
                    
                    return false;
                });
                
                // Check for private IP (192.168.x.x, 10.x.x.x, or 172.16-31.x.x) - Android WiFi detection
                const has192IP = allIceCandidates.some(c => {
                    // Only check host type candidates
                    if (c.type !== 'host') return false;
                    
                    // Check if address field is a private IP
                    if (c.address && isPrivateIP(c.address)) {
                        return true;
                    }
                    
                    // Fallback: check candidate string for private IP pattern
                    if (c.candidate) {
                        // Match any IP address in the candidate string
                        const ipMatch = c.candidate.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
                        if (ipMatch && isPrivateIP(ipMatch[1])) {
                            return true;
                        }
                    }
                    
                    return false;
                });
                
                // WiFi is detected if either .local OR private IP is found
                const isOnWiFi = hasMDNS || has192IP;
                
                // Track analytics on timeout
                trackICECandidateAnalytics(allIceCandidates, hasMDNS, has192IP, isOnWiFi, privateIPs);
                
                if (hasPrivateIP && privateIPs.size > 0) {
                    const privateIP = Array.from(privateIPs)[0];
                    pc.close();
                    resolve({ privateIP, allCandidates: allIceCandidates, hasMDNS, has192IP, isOnWiFi });
                } else {
                    pc.close();
                    reject({ error: new Error('Timeout: No private IP found in ICE candidates'), allCandidates: allIceCandidates, hasMDNS, has192IP, isOnWiFi });
                }
            }
        }, 5000);
    });
}

// Get private IP address and check for mDNS
async function getPrivateIP() {
    try {
        console.log('🌐 Attempting to get private IP via STUN...');
        const result = await getPrivateIPViaSTUN();
        
        // result can be either { privateIP, allCandidates, hasMDNS, has192IP, isOnWiFi } or just privateIP (for backward compatibility)
        const privateIP = result.privateIP || result;
        const allCandidates = result.allCandidates || [];
        const hasMDNS = result.hasMDNS || false;
        const has192IP = result.has192IP || false;
        const isOnWiFi = result.isOnWiFi || false;
        
        console.log('✅ Private IP retrieved via STUN:', privateIP);
        const wifiMethod = hasMDNS ? 'mDNS (.local)' : (has192IP ? 'Private IP' : 'none');
        console.log('📡 WiFi detected:', isOnWiFi, wifiMethod !== 'none' ? `(via ${wifiMethod})` : '');
        return { privateIP, hasMDNS, has192IP, isOnWiFi, allCandidates };
    } catch (error) {
        // error can be either { error, allCandidates, hasMDNS, has192IP, isOnWiFi } or just Error object
        const errorObj = error.error || error;
        const allCandidates = error.allCandidates || [];
        const hasMDNS = error.hasMDNS || false;
        const has192IP = error.has192IP || false;
        const isOnWiFi = error.isOnWiFi || false;
        
        console.warn('⚠️ Failed to retrieve private IP:', errorObj.message || errorObj);
        const wifiMethod = hasMDNS ? 'mDNS (.local)' : (has192IP ? 'Private IP' : 'none');
        console.log('📡 WiFi detected:', isOnWiFi, wifiMethod !== 'none' ? `(via ${wifiMethod})` : '');
        
        // Log ICE candidates even on error
        if (allCandidates.length > 0) {
            console.log('📊 ICE candidates received before error:', allCandidates.length);
        }
        
        return { privateIP: null, hasMDNS, has192IP, isOnWiFi, allCandidates };
    }
}

// Track ICE candidate analytics
function trackICECandidateAnalytics(allCandidates, hasMDNS, has192IP, isOnWiFi, privateIPs) {
    try {
        // Group candidates by type
        const candidatesByType = {
            host: 0,
            srflx: 0,
            relay: 0,
            other: 0
        };
        
        let publicIP = null;
        let privateIP = null;
        
        allCandidates.forEach(candidate => {
            // Count by type
            if (candidatesByType.hasOwnProperty(candidate.type)) {
                candidatesByType[candidate.type]++;
            } else {
                candidatesByType.other++;
            }
            
            // Extract public IP from srflx candidates
            if (candidate.type === 'srflx' && candidate.address && !publicIP) {
                if (isPublicIP(candidate.address)) {
                    publicIP = candidate.address;
                }
            }
            
            // Extract private IP from host candidates (use first one found)
            if (candidate.type === 'host' && candidate.address && !privateIP) {
                if (isPrivateIP(candidate.address)) {
                    privateIP = candidate.address;
                }
            }
        });
        
        // If privateIPs Set is provided, use first private IP from it
        if (privateIPs && privateIPs.size > 0 && !privateIP) {
            privateIP = Array.from(privateIPs)[0];
        }
        
        // Track comprehensive ICE candidate event
        Analytics.track('ice_candidates_received', {
            total_candidates: allCandidates.length,
            host_candidates: candidatesByType.host,
            srflx_candidates: candidatesByType.srflx,
            relay_candidates: candidatesByType.relay,
            other_candidates: candidatesByType.other,
            has_public_ip: !!publicIP,
            public_ip: publicIP || null, // Only include if available
            has_private_ip: !!privateIP,
            private_ip: privateIP || null, // Only include if available
            has_mdns: hasMDNS || false,
            has_private_ip_range: has192IP || false,
            is_on_wifi: isOnWiFi || false,
            network_type: (isOnWiFi || false) ? 'wifi' : 'cellular',
            device_type: Analytics.getDeviceType()
        });
        
        // Also track public IP separately if available
        if (publicIP) {
            Analytics.track('ice_public_ip_received', {
                public_ip: publicIP,
                device_type: Analytics.getDeviceType(),
                total_candidates: allCandidates.length,
                srflx_candidates: candidatesByType.srflx
            });
        }
        
    } catch (error) {
        console.warn('Error tracking ICE candidate analytics:', error);
        // Don't break functionality
    }
}

// Check if WiFi is detected in ICE candidates (via .local mDNS or private IP)
async function hasMDNSInICE() {
    try {
        const result = await getPrivateIP();
        // Check for WiFi via either .local (mDNS) OR private IP (192.168.x.x, 10.x.x.x, or 172.16-31.x.x)
        const isOnWiFi = result.isOnWiFi || result.hasMDNS || result.has192IP || false;
        
        const detectionMethod = result.hasMDNS ? 'mDNS (.local)' : (result.has192IP ? 'Private IP' : 'none');
        console.log(`📡 WiFi check result: ${isOnWiFi ? 'Detected' : 'Not detected'}${detectionMethod !== 'none' ? ` (via ${detectionMethod})` : ''}`);
        return isOnWiFi;
    } catch (error) {
        console.error('❌ Error checking for WiFi:', error);
        return false; // Default to hide auto mode on error
    }
}

// Check WiFi and disable/hide auto mode if not detected
async function checkAndDisableAutoModeIfNoWiFi() {
    try {
        const isOnWiFi = await hasMDNSInICE();
        
        if (!isOnWiFi) {
            // WiFi not detected - disable and hide auto mode
            console.log('❌ WiFi not detected, disabling and hiding auto mode');
            
            // Disable auto mode
            autoModeEnabled = false;
            
            // Hide and disable the switch
            const autoModeContainer = elements.autoModeSwitch?.closest('.auto-mode-toggle-container');
            if (autoModeContainer) {
                autoModeContainer.style.display = 'none';
            }
            
            if (elements.autoModeSwitch) {
                elements.autoModeSwitch.checked = false;
                elements.autoModeSwitch.disabled = true;
                elements.autoModeSwitch.classList.remove('auto-mode-peer');
            }
            
            // Dismiss any auto mode notification
            if (autoModeNotification) {
                autoModeNotification.remove();
                autoModeNotification = null;
            }
            
            // Reinitialize peer with normal auto-generated ID
            console.log('🔄 Reinitializing peer with normal auto-generated ID...');
            initPeerJS();
        } else {
            console.log('✅ WiFi still detected, keeping auto mode enabled');
        }
    } catch (error) {
        console.error('❌ Error checking WiFi for auto mode:', error);
        // On error, assume no WiFi and disable auto mode
        autoModeEnabled = false;
        const autoModeContainer = elements.autoModeSwitch?.closest('.auto-mode-toggle-container');
        if (autoModeContainer) {
            autoModeContainer.style.display = 'none';
        }
        if (elements.autoModeSwitch) {
            elements.autoModeSwitch.checked = false;
            elements.autoModeSwitch.disabled = true;
        }
        
        // Reinitialize peer with normal auto-generated ID
        console.log('🔄 Reinitializing peer with normal auto-generated ID (error case)...');
        initPeerJS();
    }
}

// Update auto mode button visibility based on WiFi detection in ICE candidates
// Shows button if WiFi is detected (via .local mDNS or private IP), hides if not found
async function updateAutoModeButtonVisibility() {
    // Use the existing auto mode switch element to find its container
    if (!elements.autoModeSwitch) {
        console.warn('Auto mode switch element not found');
        return;
    }
    
    const autoModeContainer = elements.autoModeSwitch.closest('.auto-mode-toggle-container');
    if (!autoModeContainer) {
        console.warn('Auto mode toggle container not found');
        return;
    }
    
    // Ensure button is hidden while processing
    autoModeContainer.style.display = 'none';
    
    try {
        // Create a 2 second timeout promise
        const timeoutPromise = new Promise((resolve) => {
            setTimeout(() => {
                resolve({ timeout: true, isOnWiFi: false });
            }, 2000);
        });
        
        // Race the WiFi check against 2 second timeout
        const checkPromise = hasMDNSInICE().then(isOnWiFi => ({ timeout: false, isOnWiFi }));
        
        const result = await Promise.race([checkPromise, timeoutPromise]);
        
        // Check if device is Android or iOS
        const userAgent = navigator.userAgent.toLowerCase();
        const isAndroid = /android/.test(userAgent);
        const isIOS = /iphone|ipad|ipod/.test(userAgent);
        const isMobileDevice = isAndroid || isIOS;
        
        if (result.timeout) {
            // Took more than 2 seconds - assume cellular, keep switch hidden
            console.log('⏱️ Auto mode check timed out (>2s) - assuming cellular, keeping switch hidden');
            autoModeContainer.style.display = 'none';
            
            // On Android/iOS, also disable the switch when WiFi is not detected
            if (isMobileDevice && elements.autoModeSwitch) {
                elements.autoModeSwitch.disabled = true;
                console.log('🔒 Auto mode switch disabled (mobile device, WiFi not detected)');
            }
            
            // Also disable auto mode if it was enabled
            if (autoModeEnabled) {
                console.log('🔄 Auto mode was enabled, disabling due to timeout (likely cellular)');
                if (elements.autoModeSwitch) {
                    elements.autoModeSwitch.checked = false;
                }
                autoModeEnabled = false;
            }
            return;
        }
        
        // Check completed within 2 seconds
        const isOnWiFi = result.isOnWiFi;
        
        if (isOnWiFi) {
            // Show auto mode button if WiFi is detected (via .local or private IP)
            autoModeContainer.style.display = '';
            
            // Enable the switch on mobile devices when WiFi is detected
            if (isMobileDevice && elements.autoModeSwitch) {
                elements.autoModeSwitch.disabled = false;
                console.log('✅ Auto mode switch enabled (mobile device, WiFi detected)');
            }
            
            console.log('✅ Auto mode button shown (WiFi detected in ICE candidates)');
        } else {
            // Hide auto mode button if WiFi is not detected
            autoModeContainer.style.display = 'none';
            console.log('❌ Auto mode button hidden (no WiFi detected in ICE candidates)');
            
            // On Android/iOS, also disable the switch when WiFi is not detected
            if (isMobileDevice && elements.autoModeSwitch) {
                elements.autoModeSwitch.disabled = true;
                console.log('🔒 Auto mode switch disabled (mobile device, WiFi not detected)');
            }
            
            // Also disable auto mode if it was enabled
            if (autoModeEnabled) {
                console.log('🔄 Auto mode was enabled, disabling due to no WiFi detected');
                if (elements.autoModeSwitch) {
                    elements.autoModeSwitch.checked = false;
                }
                autoModeEnabled = false;
            }
        }
    } catch (error) {
        console.error('❌ Error updating auto mode button visibility:', error);
        // Keep button hidden on error
        autoModeContainer.style.display = 'none';
        
        // On Android/iOS, also disable the switch on error
        const userAgent = navigator.userAgent.toLowerCase();
        const isAndroid = /android/.test(userAgent);
        const isIOS = /iphone|ipad|ipod/.test(userAgent);
        const isMobileDevice = isAndroid || isIOS;
        
        if (isMobileDevice && elements.autoModeSwitch) {
            elements.autoModeSwitch.disabled = true;
            console.log('🔒 Auto mode switch disabled (mobile device, error during WiFi check)');
        }
    }
}

// Get public IP - Primary: STUN, Fallback: External API, Final: Timestamp
async function getPublicIP() {
    // Try STUN method first (preferred)
    try {
        console.log('🌐 Attempting to get public IP via STUN...');
        const publicIP = await getPublicIPViaSTUN();
        console.log('✅ Public IP retrieved via STUN:', publicIP);
        return publicIP;
    } catch (stunError) {
        console.warn('⚠️ STUN method failed, trying external API:', stunError);
        
        // Fallback to external API
        try {
            // Use AbortController for timeout (more compatible than AbortSignal.timeout)
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            const response = await fetch('https://api.ipify.org?format=json', {
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            const data = await response.json();
            if (data.ip && isPublicIP(data.ip)) {
                console.log('✅ Public IP retrieved via API:', data.ip);
                return data.ip;
            }
        } catch (apiError) {
            console.warn('⚠️ External API also failed:', apiError);
        }
        
        // Final fallback: throw error (caller will use timestamp)
        throw new Error('All methods failed to retrieve public IP');
    }
}

// Convert IP to peer ID format (first 8 digits)
function formatIPForPeerID(ip) {
    if (!ip) {
        throw new Error('IP address is required');
    }
    
    // Handle IPv4 (e.g., "103.142.11.33" -> "10314211")
    if (ip.includes('.')) {
        const parts = ip.split('.');
        if (parts.length === 4) {
            // Part 1: Include all digits
            const part1 = parts[0];
            
            // Part 2: Include all digits
            const part2 = parts[1];
            
            // Part 3: Take only first 2 digits (or just 1 if it's only 1 digit)
            const part3 = parts[2].substring(0, 2);
            
            // Part 4: Ignored
            
            // Combine: part1 + part2 + part3 (first 2 digits)
            const suffix = part1 + part2 + part3;
            
            return suffix; // Length can vary (no padding)
        }
    }
    
    // Handle IPv6 (e.g., "2001:0db8:85a3:0000:0000:8a2e:0370:7334")
    // Keep current IPv6 logic
    if (ip.includes(':')) {
        // Remove colons and take first 8 numeric characters
        const hex = ip.replace(/:/g, '').substring(0, 8);
        // Extract numeric digits
        const digits = hex.replace(/[^0-9]/g, '').substring(0, 8);
        if (digits.length < 8) {
            // If not enough digits, use hex characters converted to decimal
            const hexDigits = hex.substring(0, 8).split('').map(c => {
                const num = parseInt(c, 16);
                return isNaN(num) ? '0' : num.toString();
            }).join('').substring(0, 8);
            return hexDigits.padEnd(8, '0');
        }
        return digits;
    }
    
    // Fallback: extract first 8 numeric digits
    const digits = ip.replace(/[^0-9]/g, '').substring(0, 8);
    return digits.padEnd(8, '0');
}

// Switch to auto mode
async function switchToAutoMode() {
    console.log('🔄 Switching to auto mode...');
    
    // Check if currently editing - cancel edit mode first
    const peerIdEditElement = document.getElementById('peer-id-edit');
    if (peerIdEditElement && !peerIdEditElement.classList.contains('hidden')) {
        cancelEditingPeerId();
    }
    
    // Store attempted peer ID for error handling
    let attemptedPeerId = null;
    
    try {
        // Show loading state
        updateConnectionStatus('connecting', 'Switching to auto mode...');
        
        // Fetch public IP address
        updateConnectionStatus('connecting', 'Fetching network information...');
        let publicIP;
        try {
            publicIP = await getPublicIP();
        } catch (ipError) {
            console.error('❌ Failed to fetch public IP:', ipError);
            throw new Error('Failed to enable auto mode');
        }
        
        // Format IP for peer ID
        let peerIdSuffix;
        try {
            peerIdSuffix = formatIPForPeerID(publicIP);
            console.log('✅ Public IP retrieved:', publicIP, '→ Suffix:', peerIdSuffix);
        } catch (formatError) {
            console.error('❌ Failed to format IP:', formatError);
            throw new Error('Failed to enable auto mode');
        }
        
        // Generate peer ID
        const autoModePeerId = `automatic-mode-${peerIdSuffix}`;
        attemptedPeerId = autoModePeerId; // Store for error handling
        console.log('🆔 Generated auto mode peer ID:', autoModePeerId);
        
        // Destroy existing peer if any
        if (peer) {
            peer._isChangingId = true;
            peer.destroy();
            peer = null;
        }
        
        // Clear connections
        connections.clear();
        
        // Set auto mode state
        autoModeEnabled = true;
        
        // Initialize new peer with dynamic ID
        peer = new Peer(autoModePeerId, {
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
            }, 10000);
            
            peer.once('open', (id) => {
                clearTimeout(timeout);
                resolve(id);
            });
            
            peer.once('error', (err) => {
                clearTimeout(timeout);
                // Store the attempted peer ID in the error for later use
                err.attemptedPeerId = autoModePeerId;
                reject(err);
            });
        });
        
        // Update UI - peer ID should already be set in peer.on('open')
        // But we'll ensure it's set correctly
        const peerIdElement = document.getElementById('peer-id');
        if (peerIdElement) {
            peerIdElement.textContent = autoModePeerId;
        }
        
        // Generate QR code
        generateQRCode(autoModePeerId);
        
        // Disable edit button
        updateEditButtonState();
        
        // Update toggle visual state
        if (elements.autoModeSwitch) {
            elements.autoModeSwitch.checked = true;
        }
        
        // Store notification reference and show without auto-dismiss (duration = 0 means persistent)
        autoModeNotification = showAutoModeNotification('Auto mode enabled. Turn it on for other devices on the same Wi-Fi / Network to auto connect to this device.\n\nAuto mode works only on WiFi / Local Network.\n\nTo reset Auto mode, press & hold the \'Auto\' text on any connected device for 5 seconds.', 'success');
        
        // Track auto mode enable
        Analytics.track('auto_mode_enabled', {
            device_type: Analytics.getDeviceType(),
            public_ip: publicIP,
            peer_id_suffix: peerIdSuffix
        });
        
    } catch (error) {
        console.error('Error switching to auto mode:', error);
        
        // Check if this is an "ID taken" error
        const isIdTaken = error.type === 'unavailable-id' || 
                         error.message.includes('is taken') || 
                         error.message.includes('unavailable-id') ||
                         (error.attemptedPeerId && error.type === 'unavailable-id');
        
        if (isIdTaken) {
            // Get the attempted peer ID from error or stored value
            const takenPeerId = error.attemptedPeerId || attemptedPeerId;
            if (!takenPeerId) {
                console.error('No peer ID found for auto-connect');
                // Fall through to normal error handling
            } else {
                console.log('🔗 Auto mode peer ID taken:', takenPeerId, '- Attempting auto-connect');
                
                // Keep switch ON and change to orange (peer mode) immediately
                // Don't turn off the switch - just change color to indicate peer mode
                if (elements.autoModeSwitch) {
                    elements.autoModeSwitch.checked = true; // Keep switch ON
                    elements.autoModeSwitch.classList.add('auto-mode-peer'); // Change to orange
                    console.log('✅ Switch kept ON, changed to peer mode (orange)');
                }
                
                // Keep autoModeEnabled = true since we're still in auto mode (as a peer)
                // autoModeEnabled remains true - we're transitioning to peer mode, not disabling auto mode
                
                // Reinitialize with auto-generated ID (we need a peer to connect from)
                updateConnectionStatus('', 'Ready to connect');
                initPeerJS();
                
                // Wait for peer to be ready, then auto-connect
                // We'll use a flag to detect when peer is ready
                const checkPeerReady = () => {
                    if (peer && peer.id && !peer.destroyed) {
                        console.log('✅ Peer ready, auto-connecting to:', takenPeerId);
                        autoConnectToPeer(takenPeerId);
                    } else {
                        // Wait a bit more
                        setTimeout(checkPeerReady, 500);
                    }
                };
                
                // Start checking after a short delay
                setTimeout(checkPeerReady, 1000);
                
                // Track auto-connect attempt
                Analytics.track('auto_mode_auto_connect', {
                    device_type: Analytics.getDeviceType(),
                    target_peer_id: takenPeerId,
                    reason: 'peer_id_taken'
                });
                
                return; // Don't show error, auto-connect will handle notification
            }
        }
        
        // For other errors, show normal error handling
        autoModeEnabled = false;
        if (elements.autoModeSwitch) {
            elements.autoModeSwitch.checked = false;
        }
        
        let errorMessage = 'Failed to enable auto mode';
        showNotification(errorMessage, 'error');
        updateConnectionStatus('', 'Ready to connect');
        
        // Reinitialize with auto-generated ID
        initPeerJS();
    }
}

// Switch from auto mode
async function switchFromAutoMode() {
    console.log('🔄 Switching from auto mode...');
    
    try {
        // Show loading state
        updateConnectionStatus('connecting', 'Switching from auto mode...');
        
        // Destroy existing peer if any
        if (peer) {
            peer._isChangingId = true;
            peer.destroy();
            peer = null;
        }
        
        // Clear connections
        connections.clear();
        
        // Set auto mode state
        autoModeEnabled = false;
        
        // Initialize new peer with auto-generated ID (no custom ID)
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
        
        // Wait for the peer to be ready - the ID will be auto-generated
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout waiting for peer to open'));
            }, 10000);
            
            peer.once('open', (id) => {
                clearTimeout(timeout);
                resolve(id);
            });
            
            peer.once('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });
        });
        
        // Peer ID will be set automatically in peer.on('open') handler
        // But we'll ensure QR code is updated
        
        // Enable edit button
        updateEditButtonState();
        
        // Update toggle visual state
        if (elements.autoModeSwitch) {
            elements.autoModeSwitch.checked = false;
        }
        
        // Dismiss auto mode notification if it's still showing
        if (autoModeNotification) {
            console.log('✅ Auto mode disabled, dismissing notification');
            autoModeNotification.remove();
            autoModeNotification = null;
        }
        
        showNotification('Auto mode disabled', 'success');
        
        // Track auto mode disable
        Analytics.track('auto_mode_disabled', {
            device_type: Analytics.getDeviceType()
        });
        
    } catch (error) {
        console.error('Error switching from auto mode:', error);
        autoModeEnabled = true; // Revert state
        if (elements.autoModeSwitch) {
            elements.autoModeSwitch.checked = true;
        }
        
        showNotification('Failed to disable auto mode', 'error');
        updateConnectionStatus('', 'Ready to connect');
    }
}

// Switch from peer mode (disconnect from auto mode peer)
async function switchFromPeerMode() {
    console.log('🔄 Switching off from peer mode...');
    
    try {
        // Disconnect from auto mode peer
        if (autoModePeerId && connections.has(autoModePeerId)) {
            const conn = connections.get(autoModePeerId);
            if (conn && conn.open) {
                conn.close();
            }
            connections.delete(autoModePeerId);
            console.log('✅ Disconnected from auto mode peer:', autoModePeerId);
        }
        
        // Reset peer mode state
        const disconnectedPeerId = autoModePeerId;
        autoModeConnectedAsPeer = false;
        autoModePeerId = null;
        
        // Destroy existing peer
        if (peer) {
            peer._isChangingId = true;
            peer.destroy();
            peer = null;
        }
        
        // Clear all connections
        connections.clear();
        
        // Reinitialize with auto-generated ID
        updateConnectionStatus('connecting', 'Disconnecting from auto mode peer...');
        initPeerJS();
        
        // Wait for peer to be ready
        // peer.on('open') will handle UI updates automatically
        
        // Update switch state
        if (elements.autoModeSwitch) {
            elements.autoModeSwitch.checked = false;
            elements.autoModeSwitch.classList.remove('auto-mode-peer');
        }
        
        showNotification('Disconnected from auto mode peer', 'success');
        
        // Track disconnect
        Analytics.track('auto_mode_peer_disconnected', {
            device_type: Analytics.getDeviceType(),
            peer_id: disconnectedPeerId
        });
        
    } catch (error) {
        console.error('Error switching from peer mode:', error);
        showNotification('Failed to disconnect from auto mode peer', 'error');
        
        // Reset state even on error
        autoModeConnectedAsPeer = false;
        autoModePeerId = null;
        if (elements.autoModeSwitch) {
            elements.autoModeSwitch.checked = false;
            elements.autoModeSwitch.classList.remove('auto-mode-peer');
        }
    }
}

// Handle auto mode toggle
async function handleAutoModeToggle() {
    const switchElement = elements.autoModeSwitch;
    if (!switchElement) {
        console.error('Auto mode switch element not found');
        return;
    }
    
    // Check if toggle is disabled (has other connections, not peer mode)
    if (switchElement.disabled) {
        showNotification('Cannot change auto mode while connected to peers', 'warning');
        // Revert toggle state
        switchElement.checked = !switchElement.checked;
        return;
    }
    
    const shouldEnable = switchElement.checked;
    
    // Check if currently in peer mode and user wants to turn off
    if (autoModeConnectedAsPeer && !shouldEnable) {
        console.log('🔄 User toggling off from peer mode');
        await switchFromPeerMode();
        return;
    }
    
    if (shouldEnable) {
        // Check if connections exist
        if (connections.size > 0) {
            showNotification('Cannot enable auto mode while connected to peers', 'warning');
            switchElement.checked = false;
            return;
        }
        
        // Check if WiFi is detected before enabling auto mode
        try {
            const isOnWiFi = await hasMDNSInICE();
            if (!isOnWiFi) {
                // WiFi not detected - show notification and revert switch
                showNotification('Auto mode only works on WiFi', 'info', 5000);
                switchElement.checked = false;
                console.log('❌ Auto mode cannot be enabled: WiFi not detected');
                return;
            }
        } catch (error) {
            // If WiFi check fails, assume no WiFi and revert switch
            console.error('❌ Error checking WiFi status:', error);
            showNotification('Auto mode only works on WiFi', 'info', 5000);
            switchElement.checked = false;
            return;
        }
        
        await switchToAutoMode();
    } else {
        // Check if connections exist
        if (connections.size > 0) {
            showNotification('Cannot disable auto mode while connected to peers', 'warning');
            switchElement.checked = true;
            return;
        }
        
        await switchFromAutoMode();
    }
}

// Start editing peer ID
function startEditingPeerId() {
    console.log('🔄 startEditingPeerId called');
    
    // Check if editing is allowed
    const canEdit = isEditingAllowed();
    console.log('Can edit peer ID:', canEdit);
    
    if (!canEdit) {
        console.log('Editing not allowed. Status:', elements.statusText?.textContent, 'Connections:', connections.size);
        showNotification('Cannot edit peer ID while connected to peers', 'warning');
        return;
    }
    
    // Get fresh references to elements to handle translation interference
    const peerIdElement = document.getElementById('peer-id');
    const peerIdEditElement = document.getElementById('peer-id-edit');
    const editButton = document.getElementById('edit-id');
    const saveButton = document.getElementById('save-id');
    const cancelButton = document.getElementById('cancel-edit');
    
    console.log('Elements found:', {
        peerId: !!peerIdElement,
        peerIdEdit: !!peerIdEditElement,
        editButton: !!editButton,
        saveButton: !!saveButton,
        cancelButton: !!cancelButton
    });
    
    if (!peerIdElement || !peerIdEditElement || !editButton || !saveButton || !cancelButton) {
        console.error('Required elements for peer ID editing not found');
        showNotification('Error: Cannot edit peer ID - required elements not found', 'error');
        return;
    }
    
    const currentId = peerIdElement.textContent;
    console.log('Current peer ID:', currentId);
    
    // Track peer ID edit start
    Analytics.track('peer_id_edit_started', {
        current_peer_id_length: currentId.length,
        device_type: Analytics.getDeviceType()
    });
    
    peerIdEditElement.value = currentId;
    console.log('Set edit input value to:', currentId);
    
    peerIdElement.classList.add('hidden');
    peerIdEditElement.classList.remove('hidden');
    editButton.classList.add('hidden');
    saveButton.classList.remove('hidden');
    cancelButton.classList.remove('hidden');
    
    console.log('Updated element visibility');
    
    peerIdEditElement.focus();
    peerIdEditElement.select();
    
    // Ensure key event listeners are attached
    initPeerIdEditing();
    
    console.log('Peer ID editing started successfully');
}

// Save edited peer ID
async function saveEditedPeerId() {
    // Get fresh references to elements to handle translation interference
    const peerIdEditElement = document.getElementById('peer-id-edit');
    const peerIdElement = document.getElementById('peer-id');
    const editButton = document.getElementById('edit-id');
    const saveButton = document.getElementById('save-id');
    const cancelButton = document.getElementById('cancel-edit');
    
    if (!peerIdEditElement || !peerIdElement || !editButton || !saveButton || !cancelButton) {
        console.error('Required elements for peer ID editing not found');
        showNotification('Error: Cannot save peer ID - required elements not found', 'error');
        return;
    }
    
    const newPeerId = peerIdEditElement.value.trim();
    
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
        const peerIdElement = document.getElementById('peer-id');
        if (peerIdElement) {
            peerIdElement.textContent = newPeerId;
        }
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
    // Get fresh references to elements to handle translation interference
    const peerIdElement = document.getElementById('peer-id');
    const peerIdEditElement = document.getElementById('peer-id-edit');
    const editButton = document.getElementById('edit-id');
    const saveButton = document.getElementById('save-id');
    const cancelButton = document.getElementById('cancel-edit');
    
    if (peerIdElement) peerIdElement.classList.remove('hidden');
    if (peerIdEditElement) peerIdEditElement.classList.add('hidden');
    if (editButton) editButton.classList.remove('hidden');
    if (saveButton) saveButton.classList.add('hidden');
    if (cancelButton) cancelButton.classList.add('hidden');
}

// Initialize peer ID editing - simplified to avoid conflicts with event delegation
function initPeerIdEditing() {
    // Add Enter key support for the edit input field
    const peerIdEdit = document.getElementById('peer-id-edit');
    if (peerIdEdit) {
        // Remove any existing listeners to prevent duplicates
        peerIdEdit.removeEventListener('keypress', handlePeerIdEditKeyPress);
        peerIdEdit.removeEventListener('keydown', handlePeerIdEditKeyDown);
        
        // Add new listeners
        peerIdEdit.addEventListener('keypress', handlePeerIdEditKeyPress);
        peerIdEdit.addEventListener('keydown', handlePeerIdEditKeyDown);
    }
}

// Handle key events for peer ID editing
function handlePeerIdEditKeyPress(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        saveEditedPeerId();
    }
}

function handlePeerIdEditKeyDown(e) {
    if (e.key === 'Escape') {
        e.preventDefault();
        cancelEditingPeerId();
    }
}

// Function to detect translation changes and reinitialize
function detectTranslationChanges() {
    // Check if the page has been translated by looking for translation artifacts
    const body = document.body;
    const hasTranslation = body.getAttribute('translated') || 
                          body.classList.contains('translated') ||
                          document.documentElement.lang !== 'en';
    
    if (hasTranslation) {
        console.log('🔄 Translation detected, reinitializing peer ID editing system...');
        // Wait a bit for translation to complete
        // Peer ID editing is handled by event delegation
    }
}

// Monitor for translation changes
let translationObserver = null;
if (window.MutationObserver) {
    translationObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'attributes' && 
                (mutation.attributeName === 'translated' || 
                 mutation.attributeName === 'lang')) {
                detectTranslationChanges();
            }
        });
    });
    
    translationObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['translated', 'lang']
    });
}

// Debug function - can be called from console to test peer ID editing
window.testPeerIdEditing = function() {
    console.log('🧪 Testing peer ID editing...');
    console.log('Current peer ID element:', document.getElementById('peer-id'));
    console.log('Current peer ID text:', document.getElementById('peer-id')?.textContent);
    console.log('Edit button element:', document.getElementById('edit-id'));
    console.log('Edit input element:', document.getElementById('peer-id-edit'));
    console.log('Status text:', document.getElementById('status-text')?.textContent);
    console.log('Connections count:', connections.size);
    
    // Test the edit function directly
    startEditingPeerId();
};

init();
