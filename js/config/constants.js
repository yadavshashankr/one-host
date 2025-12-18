// Simple Environment Configuration
// Change this single variable to switch between environments
const CURRENT_ENVIRONMENT = 'production'; // Change to 'production' for prod

// Environment URLs
const ENVIRONMENT_URLS = {
    production: 'https://one-host.app/',
    development: 'https://yadavshashankr.github.io/one-host-develop/'
};

// GitHub Repository URLs
const GITHUB_URLS = {
    production: 'https://github.com/yadavshashankr/one-host.git',
    development: 'https://github.com/yadavshashankr/one-host-develop.git'
};

// Get the base URL for current environment
const BASE_URL = ENVIRONMENT_URLS[CURRENT_ENVIRONMENT];

// Get the GitHub URL for current environment
const GITHUB_URL = GITHUB_URLS[CURRENT_ENVIRONMENT];

// Configuration object
const CONFIG = {
    BASE_URL,
    GITHUB_URL,
    ENVIRONMENT: CURRENT_ENVIRONMENT,
    IS_PRODUCTION: CURRENT_ENVIRONMENT === 'production',
    IS_DEVELOPMENT: CURRENT_ENVIRONMENT === 'development',
    // Other constants
    CHUNK_SIZE: 16384,
    DB_NAME: 'fileTransferDB',
    DB_VERSION: 1,
    STORE_NAME: 'files',
    KEEP_ALIVE_INTERVAL: 30000,
    CONNECTION_TIMEOUT: 60000
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
} else {
    window.CONFIG = CONFIG;
}

// Log current configuration
console.log(`One-Host Environment: ${CURRENT_ENVIRONMENT}`);
console.log(`Base URL: ${BASE_URL}`);
console.log(`GitHub URL: ${GITHUB_URL}`);

// Message Types for WebRTC communication
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
    SIMULTANEOUS_DOWNLOAD_START: 'simultaneous-download-start',
    FORCE_DISABLE_AUTO_MODE: 'force-disable-auto-mode'
};

// Enhanced PeerJS Configuration with Multiple STUN and TURN Servers
const PEER_CONFIG = {
    debug: 2,
    config: {
        iceServers: [
            // Primary STUN servers (Google's globally distributed)
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' },
            
            // Additional STUN servers for better NAT discovery
            { urls: 'stun:global.stun.twilio.com:3478' },
            { urls: 'stun:stun.ekiga.net' },
            { urls: 'stun:stun.ideasip.com' },
            { urls: 'stun:stun.schlund.de' },
            { urls: 'stun:stun.stunprotocol.org:3478' },
            { urls: 'stun:stun.voiparound.com' },
            { urls: 'stun:stun.voipbuster.com' },
            { urls: 'stun:stun.voipstunt.com' },
            { urls: 'stun:stun.counterpath.com' },
            { urls: 'stun:stun.1und1.de' },
            { urls: 'stun:stun.gmx.net' },
            { urls: 'stun:stun.callwithus.com' },
            { urls: 'stun:stun.counterpath.net' },
            { urls: 'stun:stun.sipgate.net' },
            { urls: 'stun:stun.softjoys.com' },
            { urls: 'stun:stun.voip.aebc.com' },
            { urls: 'stun:stun.voxgratia.org' },
            { urls: 'stun:stun.xten.com' },
            
            // Free TURN servers for relay when direct connection fails
            { 
                urls: 'turn:openrelay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            { 
                urls: 'turn:openrelay.metered.ca:443',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            { 
                urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            }
        ],
        // Enhanced ICE gathering for better connectivity
        iceCandidatePoolSize: 10,
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require'
    }
};

// UI Configuration
const UI_CONFIG = {
    notificationTimeout: 5000,
    progressUpdateThreshold: 1, // Update progress every 1%
    connectionTimeout: 15000,
    reconnectionDelay: 3000
};

// Make constants globally available
window.MESSAGE_TYPES = MESSAGE_TYPES;
window.PEER_CONFIG = PEER_CONFIG;
window.UI_CONFIG = UI_CONFIG;