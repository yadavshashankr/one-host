// Simple Environment Configuration
// Change this single variable to switch between environments
const CURRENT_ENVIRONMENT = 'production'; // Change to 'development' for dev

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
export const MESSAGE_TYPES = {
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

// PeerJS Configuration
export const PEER_CONFIG = {
    debug: 2,
    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
        ]
    }
};

// UI Configuration
export const UI_CONFIG = {
    notificationTimeout: 5000,
    progressUpdateThreshold: 1, // Update progress every 1%
    connectionTimeout: 15000,
    reconnectionDelay: 3000
}; 