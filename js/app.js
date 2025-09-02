// Main Application Module
import { dom } from './utils/dom.js';
import { notificationService } from './services/notification.js';
import { storageService } from './services/storage.js';
import { checkBrowserSupport, validatePeerId, isPeerAvailable } from './utils/helpers.js';
import { PEER_CONFIG, UI_CONFIG } from './config/constants.js';

// Import other modules (to be created)
// import { PeerService } from './services/peer.js';
// import { FileService } from './services/file.js';
// import { UIService } from './services/ui.js';
// import { EventService } from './services/events.js';

class OneHostApp {
    constructor() {
        this.isInitialized = false;
        this.services = {};
        this.state = {
            peer: null,
            connections: new Map(),
            transferInProgress: false,
            isConnectionReady: false,
            fileChunks: {},
            keepAliveInterval: null,
            connectionTimeouts: new Map(),
            isPageVisible: true,
            fileHistory: {
                sent: new Set(),
                received: new Set()
            },
            sentFileBlobs: new Map(),
            recentPeers: [],
            fileQueue: [],
            isProcessingQueue: false,
            downloadProgressMap: new Map()
        };
    }

    // Initialize the application
    async init() {
        if (this.isInitialized) return;

        try {
            console.log('Initializing One-Host application...');

            // Check browser support
            if (!checkBrowserSupport()) {
                notificationService.error('Your browser may not fully support WebRTC features');
                return;
            }

            // Initialize services
            await this.initializeServices();

            // Initialize UI
            this.initializeUI();

            // Initialize event listeners
            this.initializeEventListeners();

            // Load saved data
            await this.loadSavedData();

            // Initialize PeerJS
            await this.initializePeerJS();

            // Check URL for peer ID
            this.checkUrlForPeerId();

            // Initialize connection keep-alive
            this.initializeConnectionKeepAlive();

            this.isInitialized = true;
            console.log('One-Host application initialized successfully');

        } catch (error) {
            console.error('Failed to initialize application:', error);
            notificationService.error('Failed to initialize application');
        }
    }

    // Initialize all services
    async initializeServices() {
        // Initialize storage service
        await storageService.init();

        // Initialize notification service
        notificationService.init();

        // TODO: Initialize other services
        // this.services.peer = new PeerService(this);
        // this.services.file = new FileService(this);
        // this.services.ui = new UIService(this);
        // this.services.events = new EventService(this);
    }

    // Initialize UI
    initializeUI() {
        // Update connection status
        this.updateConnectionStatus('', 'Initializing...');
        
        // Initialize peer ID editing
        this.initializePeerIdEditing();
        
        // Initialize share button
        this.initializeShareButton();
    }

    // Initialize event listeners
    initializeEventListeners() {
        // Copy ID button
        dom.addEventListener('copyId', 'click', () => {
            const peerId = dom.getText('peerId');
            if (peerId && peerId !== 'Generating...') {
                navigator.clipboard.writeText(peerId)
                    .then(() => notificationService.success('Peer ID copied to clipboard'))
                    .catch(() => notificationService.error('Failed to copy Peer ID'));
            }
        });

        // Connect button
        dom.addEventListener('connectButton', 'click', () => {
            this.handleConnectClick();
        });

        // Enter key support for peer ID input
        dom.addEventListener('remotePeerId', 'keypress', (e) => {
            if (e.key === 'Enter') {
                this.handleConnectClick();
                dom.hide('recentPeers');
            }
        });

        // File input
        dom.addEventListener('fileInput', 'change', (e) => {
            this.handleFileInputChange(e);
        });

        // Drop zone events
        dom.addEventListener('dropZone', 'dragover', (e) => {
            e.preventDefault();
            dom.addClass('dropZone', 'drag-over');
        });

        dom.addEventListener('dropZone', 'dragleave', () => {
            dom.removeClass('dropZone', 'drag-over');
        });

        dom.addEventListener('dropZone', 'drop', (e) => {
            e.preventDefault();
            dom.removeClass('dropZone', 'drag-over');
            this.handleFileDrop(e);
        });

        dom.addEventListener('dropZone', 'click', () => {
            if (this.state.connections.size > 0) {
                dom.get('fileInput').click();
            } else {
                notificationService.error('Please connect to at least one peer first');
            }
        });

        // Recent peers events
        dom.addEventListener('remotePeerId', 'focus', () => {
            if (this.state.recentPeers.length > 0) {
                dom.show('recentPeers');
            }
        });

        dom.addEventListener('remotePeerId', 'blur', () => {
            setTimeout(() => dom.hide('recentPeers'), 200);
        });

        dom.addEventListener('clearPeers', 'click', () => {
            this.state.recentPeers = [];
            storageService.saveRecentPeers(this.state.recentPeers);
            this.updateRecentPeersList();
            dom.hide('recentPeers');
        });

        // Page visibility events
        document.addEventListener('visibilitychange', () => {
            this.handleVisibilityChange();
        });

        window.addEventListener('focus', () => {
            this.handlePageFocus();
        });

        window.addEventListener('blur', () => {
            this.handlePageBlur();
        });

        window.addEventListener('beforeunload', (event) => {
            this.handleBeforeUnload(event);
        });
    }

    // Load saved data
    async loadSavedData() {
        try {
            // Load recent peers
            this.state.recentPeers = storageService.loadRecentPeers();
            this.updateRecentPeersList();

            // Load file history
            this.state.fileHistory = storageService.loadFileHistory();

        } catch (error) {
            console.error('Error loading saved data:', error);
        }
    }

    // Initialize PeerJS
    async initializePeerJS() {
        try {
            console.log('Initializing PeerJS...');
            
            // Destroy existing peer if any
            if (this.state.peer) {
                console.log('Destroying existing peer connection');
                this.state.peer.destroy();
                this.state.peer = null;
            }

            // Clear existing connections
            this.state.connections.clear();

            // Create new peer with auto-generated ID
            this.state.peer = new Peer(PEER_CONFIG);

            this.setupPeerHandlers();

        } catch (error) {
            console.error('PeerJS Initialization Error:', error);
            this.updateConnectionStatus('', 'Initialization failed');
            notificationService.error('Failed to initialize peer connection');
        }
    }

    // Setup PeerJS event handlers
    setupPeerHandlers() {
        if (!this.state.peer) {
            console.error('Cannot setup handlers: peer is null');
            return;
        }

        this.state.peer.on('open', (id) => {
            console.log('Peer opened with ID:', id);
            dom.setText('peerId', id);
            this.updateConnectionStatus('', 'Ready to connect');
            this.generateQRCode(id);
            this.initializeShareButton();
            this.updateEditButtonState();
        });

        this.state.peer.on('connection', (conn) => {
            console.log('Incoming connection from:', conn.peer);
            this.state.connections.set(conn.peer, conn);
            this.updateConnectionStatus('connecting', 'Incoming connection...');
            this.setupConnectionHandlers(conn);
        });

        this.state.peer.on('error', (error) => {
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
            
            this.updateConnectionStatus('', errorMessage);
            // No notification - status change will inform the user

            // If this was during a custom ID setup, revert to auto-generated ID
            if (dom.hasClass('peerIdEdit', 'hidden') === false) {
                this.cancelEditingPeerId();
                this.initializePeerJS(); // Reinitialize with auto-generated ID
            }
        });

        this.state.peer.on('disconnected', () => {
            console.log('Peer disconnected');
            this.updateConnectionStatus('', 'Disconnected');
            this.state.isConnectionReady = false;
            
            // Try to reconnect
            setTimeout(() => {
                if (this.state.peer && !this.state.peer.destroyed) {
                    console.log('Attempting to reconnect...');
                    this.state.peer.reconnect();
                }
            }, UI_CONFIG.reconnectionDelay);
        });

        this.state.peer.on('close', () => {
            console.log('Peer connection closed');
            this.updateConnectionStatus('', 'Connection closed');
            this.state.isConnectionReady = false;
        });
    }

    // Handle connect button click
    handleConnectClick() {
        const remotePeerIdValue = dom.getValue('remotePeerId').trim();
        if (!remotePeerIdValue) {
            notificationService.error('Please enter a Peer ID');
            return;
        }

        // Validate and clean the peer ID
        const validatedPeerId = validatePeerId(remotePeerIdValue);
        if (!validatedPeerId) {
            notificationService.error('Invalid Peer ID format. Use only letters, numbers, hyphens, and underscores (3-50 characters)');
            return;
        }

        if (this.state.connections.has(validatedPeerId)) {
            // notificationService.warning('Already connected to this peer'); // Suppressed as per user request
            return;
        }

        // Check if our peer is ready
        if (!isPeerAvailable(this.state.peer, validatedPeerId)) {
            notificationService.error('Please wait for your peer to be ready');
            return;
        }

        try {
            console.log('Attempting to connect to:', validatedPeerId);
            this.updateConnectionStatus('connecting', 'Connecting...');
            
            const newConnection = this.state.peer.connect(validatedPeerId, {
                reliable: true
            });
            
            this.state.connections.set(validatedPeerId, newConnection);
            this.setupConnectionHandlers(newConnection);
            
        } catch (error) {
            console.error('Connection attempt error:', error);
            notificationService.error('Failed to establish connection');
            this.updateConnectionStatus('', 'Connection failed');
        }
    }

    // Setup connection handlers
    setupConnectionHandlers(conn) {
        conn.on('open', () => {
            console.log('Connection opened with:', conn.peer);
            this.state.isConnectionReady = true;
            this.updateConnectionStatus('connected', `Connected to peer(s) : ${this.state.connections.size}`);
            dom.show('fileTransferSection');
            this.addRecentPeer(conn.peer);
            
            // Clear any existing timeout for this connection
            if (this.state.connectionTimeouts.has(conn.peer)) {
                clearTimeout(this.state.connectionTimeouts.get(conn.peer));
                this.state.connectionTimeouts.delete(conn.peer);
            }
            
            // Send a connection notification to the other peer
            conn.send({
                type: 'connection-notification',
                peerId: this.state.peer.id
            });
        });

        // TODO: Add data handling
        // conn.on('data', (data) => {
        //     this.handleConnectionData(data, conn);
        // });

        conn.on('close', () => {
            console.log('Connection closed with:', conn.peer);
            this.state.connections.delete(conn.peer);
            
            // Clear timeout for this connection
            if (this.state.connectionTimeouts.has(conn.peer)) {
                clearTimeout(this.state.connectionTimeouts.get(conn.peer));
                this.state.connectionTimeouts.delete(conn.peer);
            }
            
            this.updateConnectionStatus(this.state.connections.size > 0 ? 'connected' : '', 
                this.state.connections.size > 0 ? `Connected to peer(s) : ${this.state.connections.size}` : 'Disconnected');
            if (this.state.connections.size === 0) {
                notificationService.error('All peers disconnected');
            } else {
                notificationService.warning(`Peer ${conn.peer} disconnected`);
            }
        });

        conn.on('error', (error) => {
            console.error('Connection Error:', error);
            this.updateConnectionStatus('', 'Connection error');
            notificationService.error('Connection error occurred');
            
            // Set a timeout to attempt reconnection
            if (!this.state.connectionTimeouts.has(conn.peer)) {
                const timeout = setTimeout(() => {
                    console.log(`Attempting to reconnect to ${conn.peer} after error...`);
                    this.reconnectToPeer(conn.peer);
                    this.state.connectionTimeouts.delete(conn.peer);
                }, 5000); // Wait 5 seconds before attempting reconnection
                
                this.state.connectionTimeouts.set(conn.peer, timeout);
            }
        });
    }

    // Update connection status
    updateConnectionStatus(status, message) {
        dom.setHTML('statusDot', `<div class="status-dot ${status || ''}"></div>`);
        dom.setText('statusText', message.charAt(0).toUpperCase() + message.slice(1));
        
        // Update title to show number of connections
        if (this.state.connections && this.state.connections.size > 0) {
            document.title = `(${this.state.connections.size}) One-Host`;
        } else {
            document.title = 'One-Host';
        }
        this.updateEditButtonState();
    }

    // Add recent peer
    addRecentPeer(peerId) {
        this.state.recentPeers = storageService.addRecentPeer(this.state.recentPeers, peerId);
        this.updateRecentPeersList();
    }

    // Update recent peers list
    updateRecentPeersList() {
        dom.clear('recentPeersList');
        this.state.recentPeers.forEach(peerId => {
            const li = dom.createElement('li');
            const icon = dom.createElement('span', 'material-icons');
            icon.textContent = 'person';
            li.appendChild(icon);
            li.appendChild(document.createTextNode(peerId));
            li.onclick = () => {
                dom.setValue('remotePeerId', peerId);
                dom.hide('recentPeers');
                this.handleConnectClick();
            };
            dom.appendChild('recentPeersList', li);
        });
    }

    // Generate QR Code
    generateQRCode(peerId) {
        try {
            if (!dom.get('qrcode')) return;
            dom.clear('qrcode');
            
            // Generate URL with peer ID as query parameter
            const baseUrl = window.CONFIG?.BASE_URL || (window.location.origin + window.location.pathname);
            const qrUrl = `${baseUrl}?peer=${peerId}`;
            
            new QRCode(dom.get('qrcode'), {
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

    // Initialize share button
    initializeShareButton() {
        if (navigator.share) {
            dom.show('shareId');
            dom.addEventListener('shareId', 'click', () => {
                this.shareId();
            });
        } else {
            dom.hide('shareId');
        }
    }

    // Share peer ID
    async shareId() {
        try {
            const peerId = dom.getText('peerId');
            const baseUrl = window.CONFIG?.BASE_URL || 'https://one-host.app/';
            const qrUrl = `${baseUrl}?peer=${peerId}`;
            await navigator.share({ url: qrUrl });
            notificationService.success('Share successful!');
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('Error sharing:', error);
                notificationService.error('Failed to share');
            }
        }
    }

    // Check URL for peer ID
    checkUrlForPeerId() {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const peerId = urlParams.get('peer');
            
            if (peerId && peerId.length > 0) {
                dom.setValue('remotePeerId', peerId);
                // Wait a bit for PeerJS to initialize
                setTimeout(() => {
                    this.handleConnectClick();
                }, 1500);
            }
        } catch (error) {
            console.error('Error parsing URL parameters:', error);
        }
    }

    // Initialize connection keep-alive
    initializeConnectionKeepAlive() {
        // Start keep-alive interval
        this.state.keepAliveInterval = setInterval(() => {
            if (this.state.connections.size > 0 && this.state.isPageVisible) {
                this.sendKeepAlive();
            }
        }, 30000); // 30 seconds
    }

    // Send keep-alive messages
    sendKeepAlive() {
        const keepAliveData = {
            type: 'keep-alive',
            timestamp: Date.now(),
            peerId: this.state.peer.id
        };

        for (const [peerId, conn] of this.state.connections) {
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

    // Handle visibility change
    handleVisibilityChange() {
        this.state.isPageVisible = !document.hidden;
        
        if (this.state.isPageVisible) {
            console.log('Page became visible, checking connections...');
            this.checkConnections();
        } else {
            console.log('Page became hidden, maintaining connections...');
            this.sendKeepAlive();
        }
    }

    // Handle page focus
    handlePageFocus() {
        console.log('Page focused, checking connections...');
        this.checkConnections();
    }

    // Handle page blur
    handlePageBlur() {
        console.log('Page blurred, maintaining connections...');
        this.sendKeepAlive();
    }

    // Handle before unload
    handleBeforeUnload(event) {
        if (this.state.connections.size > 0) {
            this.sendDisconnectNotification();
        }
    }

    // Check connections
    checkConnections() {
        for (const [peerId, conn] of this.state.connections) {
            if (!conn.open) {
                console.log(`Connection to ${peerId} is closed, attempting to reconnect...`);
                this.reconnectToPeer(peerId);
            }
        }
    }

    // Reconnect to peer
    reconnectToPeer(peerId) {
        try {
            console.log(`Attempting to reconnect to peer: ${peerId}`);
            const newConnection = this.state.peer.connect(peerId, {
                reliable: true
            });
            this.state.connections.set(peerId, newConnection);
            this.setupConnectionHandlers(newConnection);
        } catch (error) {
            console.error(`Failed to reconnect to peer ${peerId}:`, error);
            this.state.connections.delete(peerId);
        }
    }

    // Send disconnect notification
    sendDisconnectNotification() {
        const disconnectData = {
            type: 'disconnect-notification',
            peerId: this.state.peer.id,
            timestamp: Date.now()
        };

        for (const [peerId, conn] of this.state.connections) {
            if (conn && conn.open) {
                try {
                    conn.send(disconnectData);
                } catch (error) {
                    console.error(`Failed to send disconnect notification to peer ${peerId}:`, error);
                }
            }
        }
    }

    // Handle file input change
    handleFileInputChange(e) {
        if (this.state.connections.size > 0) {
            const files = e.target.files;
            if (files.length > 0) {
                if (files.length > 1) {
                    notificationService.info(`Processing ${files.length} files`);
                }
                Array.from(files).forEach(file => {
                    this.state.fileQueue.push(file);
                });
                this.processFileQueue();
            }
            // Reset the input so the same file can be selected again
            e.target.value = '';
        } else {
            notificationService.error('Please connect to at least one peer first');
        }
    }

    // Handle file drop
    handleFileDrop(e) {
        if (this.state.connections.size > 0) {
            const files = e.dataTransfer.files;
            if (files.length > 1) {
                notificationService.info(`Processing ${files.length} files`);
            }
            Array.from(files).forEach(file => {
                this.state.fileQueue.push(file);
            });
            this.processFileQueue();
        } else {
            notificationService.error('Please connect to at least one peer first');
        }
    }

    // Process file queue
    async processFileQueue() {
        // TODO: Implement file processing
        console.log('File queue processing not yet implemented');
    }

    // Initialize peer ID editing
    initializePeerIdEditing() {
        // TODO: Implement peer ID editing
        console.log('Peer ID editing not yet implemented');
    }

    // Update edit button state
    updateEditButtonState() {
        // TODO: Implement edit button state management
        console.log('Edit button state management not yet implemented');
    }

    // Cancel editing peer ID
    cancelEditingPeerId() {
        // TODO: Implement cancel editing
        console.log('Cancel editing not yet implemented');
    }

    // Reset connection
    resetConnection() {
        if (this.state.connections.size > 0) {
            this.state.connections.forEach((conn, peerId) => {
                if (conn && conn.open) {
                    conn.close();
                }
            });
            this.state.connections.clear();
        }
        
        // Clear all connection timeouts
        this.state.connectionTimeouts.forEach(timeout => clearTimeout(timeout));
        this.state.connectionTimeouts.clear();
        
        this.state.isConnectionReady = false;
        this.state.transferInProgress = false;
        this.state.fileQueue = []; // Clear the file queue
        this.state.isProcessingQueue = false;
        dom.hide('fileTransferSection');
        dom.hide('transferProgress');
        dom.setHTML('progress', '<div class="progress" style="width: 0%"></div>');
        dom.setAttribute('transferInfo', 'style', 'display: none');
        this.updateConnectionStatus('', 'Ready to connect');
    }

    // Get application state
    getState() {
        return this.state;
    }

    // Get service by name
    getService(name) {
        return this.services[name];
    }
}

// Create and export singleton instance
export const app = new OneHostApp();

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    app.init();
}); 