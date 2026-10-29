// Session State Manager Service
// Manages sessionAvailable flag and tracked peers with tried flags
// Persists state in sessionStorage (cleared on tab close or refresh)

class SessionStateManager {
    constructor() {
        this.sessionAvailable = false;
        this.trackedPeers = new Map(); // Map<peerId, { tried: boolean }>
        
        // SessionStorage keys
        this.STORAGE_KEY_SESSION_AVAILABLE = 'oneHost_sessionAvailable';
        this.STORAGE_KEY_TRACKED_PEERS = 'oneHost_trackedPeers';
    }
    
    // Load session state from sessionStorage
    loadState() {
        try {
            // Check if this is a refresh (reload) vs navigation
            const isRefresh = this.isPageRefresh();
            
            if (isRefresh) {
                // Manual refresh or swipe refresh - clear everything
                sessionStorage.removeItem(this.STORAGE_KEY_SESSION_AVAILABLE);
                sessionStorage.removeItem(this.STORAGE_KEY_TRACKED_PEERS);
                this.sessionAvailable = false;
                this.trackedPeers = new Map();
                console.log('🔄 Page refreshed, cleared session state');
            } else {
                // Navigation (not refresh) - load persisted state
                const stored = sessionStorage.getItem(this.STORAGE_KEY_SESSION_AVAILABLE);
                this.sessionAvailable = stored === 'true';
                
                const storedPeers = sessionStorage.getItem(this.STORAGE_KEY_TRACKED_PEERS);
                if (storedPeers) {
                    const peersObj = JSON.parse(storedPeers);
                    this.trackedPeers = new Map(Object.entries(peersObj));
                    // Ensure all peers have tried property
                    this.trackedPeers.forEach((value, peerId) => {
                        if (typeof value === 'boolean') {
                            // Legacy format: convert to object
                            this.trackedPeers.set(peerId, { tried: value });
                        } else if (!value.hasOwnProperty('tried')) {
                            // Missing tried property: add it
                            this.trackedPeers.set(peerId, { tried: false });
                        }
                    });
                    console.log(`📋 Loaded ${this.trackedPeers.size} tracked peer(s) from session`);
                }
                
                if (this.sessionAvailable) {
                    console.log('✅ Session available flag loaded: true');
                }
            }
        } catch (error) {
            console.warn('⚠️ Failed to load session state:', error);
            this.sessionAvailable = false;
            this.trackedPeers = new Map();
        }
    }
    
    // Save session state to sessionStorage
    saveState() {
        try {
            sessionStorage.setItem(this.STORAGE_KEY_SESSION_AVAILABLE, this.sessionAvailable.toString());
            // Convert Map to object for JSON storage
            const peersObj = Object.fromEntries(this.trackedPeers);
            sessionStorage.setItem(this.STORAGE_KEY_TRACKED_PEERS, JSON.stringify(peersObj));
        } catch (error) {
            console.warn('⚠️ Failed to save session state:', error);
        }
    }
    
    // Detect if page was refreshed (manual refresh or swipe refresh)
    isPageRefresh() {
        try {
            // Check Performance Navigation API
            if (performance.getEntriesByType) {
                const navEntries = performance.getEntriesByType('navigation');
                if (navEntries.length > 0) {
                    const navType = navEntries[0].type;
                    // 'reload' = manual refresh or swipe refresh
                    return navType === 'reload';
                }
            }
            
            // Fallback to legacy API
            if (performance.navigation) {
                // 1 = reload, 0 = navigate, 2 = back_forward
                return performance.navigation.type === 1;
            }
            
            return false;
        } catch (error) {
            console.warn('⚠️ Failed to detect refresh:', error);
            return false;
        }
    }
    
    // Set sessionAvailable flag
    setSessionAvailable(value) {
        if (this.sessionAvailable !== value) {
            this.sessionAvailable = value;
            this.saveState();
            console.log(`✅ Session available flag set to: ${value}`);
        }
    }
    
    // Get sessionAvailable flag
    getSessionAvailable() {
        return this.sessionAvailable;
    }
    
    // Add peer to tracked peers (with tried = false)
    addTrackedPeer(peerId) {
        if (!peerId || peerId === '') {
            return false;
        }
        
        if (!this.trackedPeers.has(peerId)) {
            this.trackedPeers.set(peerId, { tried: false });
            this.saveState();
            console.log(`➕ Added ${peerId} to tracked peers (Total: ${this.trackedPeers.size})`);
            return true;
        } else {
            // Peer already tracked - reset tried flag to false (new connection attempt)
            const peerData = this.trackedPeers.get(peerId);
            if (peerData.tried) {
                peerData.tried = false;
                this.saveState();
                console.log(`🔄 Reset tried flag for ${peerId} (new connection successful)`);
            }
            return false;
        }
    }
    
    // Mark peer as tried (reconnection failed)
    markPeerAsTried(peerId) {
        if (this.trackedPeers.has(peerId)) {
            const peerData = this.trackedPeers.get(peerId);
            if (!peerData.tried) {
                peerData.tried = true;
                this.saveState();
                console.log(`❌ Marked ${peerId} as tried (reconnection failed)`);
                return true;
            }
        }
        return false;
    }
    
    // Reset peer tried flag (reconnection succeeded)
    resetPeerTried(peerId) {
        if (this.trackedPeers.has(peerId)) {
            const peerData = this.trackedPeers.get(peerId);
            if (peerData.tried) {
                peerData.tried = false;
                this.saveState();
                console.log(`✅ Reset tried flag for ${peerId} (reconnection succeeded)`);
                return true;
            }
        }
        return false;
    }
    
    // Get all untried peers (tried === false)
    getUntriedPeers() {
        return Array.from(this.trackedPeers.entries())
            .filter(([peerId, data]) => !data.tried)
            .map(([peerId]) => peerId);
    }
    
    // Check if all peers have been tried
    areAllPeersTried() {
        if (this.trackedPeers.size === 0) {
            return false; // No peers, so not all tried
        }
        return Array.from(this.trackedPeers.values()).every(data => data.tried);
    }
    
    // Get count of tracked peers
    getTrackedPeersCount() {
        return this.trackedPeers.size;
    }
    
    // Get count of untried peers
    getUntriedPeersCount() {
        return this.getUntriedPeers().length;
    }
    
    // Clear all state (for refresh)
    clearState() {
        this.sessionAvailable = false;
        this.trackedPeers.clear();
        sessionStorage.removeItem(this.STORAGE_KEY_SESSION_AVAILABLE);
        sessionStorage.removeItem(this.STORAGE_KEY_TRACKED_PEERS);
    }
    
    // Get all tracked peer IDs (for debugging)
    getAllTrackedPeers() {
        return Array.from(this.trackedPeers.keys());
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SessionStateManager;
}
