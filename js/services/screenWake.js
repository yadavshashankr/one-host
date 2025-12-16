// Screen Wake Manager Service
// Keeps screen on during active use using Wake Lock API

class ScreenWakeManager {
    constructor() {
        this.wakeLock = null;
        this.pendingWakeLockRequest = false;
        this.isSupported = 'wakeLock' in navigator;
        this.isActive = false;
        this.activatedByTouch = false;
        this.activatedByConnection = false;
    }

    async init() {
        // Setup Wake Lock API if supported
        if (this.isSupported) {
            this.setupWakeLock();
        }
        
        // Track initialization (Analytics is global)
        if (typeof Analytics !== 'undefined') {
            Analytics.track('screen_wake_initialized', {
                wake_lock_supported: this.isSupported,
                is_ios: this.isIOS(),
                device_type: Analytics.getDeviceType()
            });
        }
    }

    async activateFromTouch() {
        if (!this.activatedByTouch) {
            this.activatedByTouch = true;
            
            // Request Wake Lock immediately on user interaction (iOS requirement)
            if (this.isSupported && !this.wakeLock) {
                await this.requestWakeLock();
            }
            
            this.isActive = true;
            console.log('✅ Screen wake activated via touch');
            
            // Track activation
            if (typeof Analytics !== 'undefined') {
                Analytics.track('screen_wake_activated', {
                    activation_source: 'touch',
                    wake_lock_active: !!this.wakeLock
                });
            }
        }
    }

    async activateFromConnection() {
        if (!this.activatedByConnection) {
            this.activatedByConnection = true;
            
            // Try to request Wake Lock
            // On iOS, this may fail without user interaction
            if (this.isSupported && !this.wakeLock) {
                const success = await this.requestWakeLock();
                if (!success && this.isIOS()) {
                    // On iOS, set flag to request on next user interaction
                    this.pendingWakeLockRequest = true;
                    console.log('⚠️ Wake Lock pending - will request on next user interaction (iOS requirement)');
                }
            }
            
            this.isActive = true;
            console.log('✅ Screen wake activated via connection');
            
            // Track activation
            if (typeof Analytics !== 'undefined') {
                Analytics.track('screen_wake_activated', {
                    activation_source: 'connection',
                    wake_lock_active: !!this.wakeLock,
                    pending_request: this.pendingWakeLockRequest
                });
            }
        }
    }

    async start(activationSource = 'unknown') {
        if (this.isActive) return;

        // Try Wake Lock API
        if (this.isSupported && !this.wakeLock) {
            const success = await this.requestWakeLock();
            if (!success && this.isIOS() && activationSource === 'connection') {
                // On iOS, connection-based activation may need user interaction
                this.pendingWakeLockRequest = true;
            }
        }

        this.isActive = true;
        console.log('✅ Screen wake activated via', activationSource);

        // Track activation
        if (typeof Analytics !== 'undefined') {
            Analytics.track('screen_wake_activated', {
                activation_source: activationSource,
                wake_lock_active: !!this.wakeLock,
                pending_request: this.pendingWakeLockRequest
            });
        }
    }

    async stop() {
        if (!this.isActive) return;

        // Release wake lock
        if (this.wakeLock) {
            await this.releaseWakeLock();
        }

        // Reset pending request flag
        this.pendingWakeLockRequest = false;

        // Track deactivation
        if (typeof Analytics !== 'undefined') {
            Analytics.track('screen_wake_deactivated', {
                was_activated_by_touch: this.activatedByTouch,
                was_activated_by_connection: this.activatedByConnection
            });
        }

        // Reset flags
        this.activatedByTouch = false;
        this.activatedByConnection = false;
        this.isActive = false;
        console.log('⏸️ Screen wake deactivated');
    }

    shouldRemainActive(connectionsSize) {
        return this.activatedByTouch || connectionsSize > 0;
    }

    async updateConnectionState(connectionsSize) {
        if (connectionsSize > 0) {
            await this.activateFromConnection();
        } else if (connectionsSize === 0) {
            if (!this.activatedByTouch) {
                await this.stop();
            }
        }
    }

    // iOS detection helper
    isIOS() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) || 
               (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }

    async setupWakeLock() {
        // Handle visibility changes - re-request wake lock when page becomes visible
        document.addEventListener('visibilitychange', async () => {
            if (document.visibilityState === 'visible' && this.isActive && !this.wakeLock) {
                // On iOS, this requires user interaction
                // Set flag to request on next user interaction
                if (this.isIOS()) {
                    this.pendingWakeLockRequest = true;
                    console.log('⚠️ Wake Lock needs re-request after visibility change (iOS requirement)');
                } else {
                    // On other platforms, try to re-request immediately
                    try {
                        await this.requestWakeLock();
                    } catch (err) {
                        console.debug('Failed to re-request wake lock:', err);
                        this.pendingWakeLockRequest = true;
                    }
                }
            }
        });
        
        // Re-request on user interaction (iOS requirement)
        ['click', 'touchstart', 'mousedown'].forEach(event => {
            document.addEventListener(event, () => {
                if (this.pendingWakeLockRequest && this.isActive) {
                    this.requestWakeLock().then(success => {
                        if (success) {
                            this.pendingWakeLockRequest = false;
                            console.log('✅ Wake Lock re-requested successfully after user interaction');
                        }
                    });
                }
            }, { once: false, passive: true });
        });
    }

    async requestWakeLock() {
        if (!this.isSupported || this.wakeLock) return false;

        try {
            this.wakeLock = await navigator.wakeLock.request('screen');
            this.wakeLock.addEventListener('release', () => {
                console.log('Wake Lock released by system');
                this.wakeLock = null;
                // Re-request if still active (requires user interaction on iOS)
                if (this.isActive && document.visibilityState === 'visible') {
                    if (this.isIOS()) {
                        this.pendingWakeLockRequest = true;
                        console.log('⚠️ Wake Lock released - will re-request on next user interaction (iOS)');
                    } else {
                        // Try to re-request immediately on non-iOS
                        this.requestWakeLock().catch(() => {
                            this.pendingWakeLockRequest = true;
                        });
                    }
                }
            });
            console.log('✅ Wake Lock API active');
            return true;
        } catch (err) {
            const errorInfo = {
                name: err.name,
                message: err.message,
                is_ios: this.isIOS(),
                requires_user_interaction: err.name === 'NotAllowedError'
            };
            
            console.warn('Wake Lock request failed:', errorInfo);
            this.wakeLock = null;
            
            // Track for analytics
            if (typeof Analytics !== 'undefined') {
                Analytics.track('wake_lock_request_failed', errorInfo);
            }
            
            return false;
        }
    }

    async releaseWakeLock() {
        if (this.wakeLock) {
            try {
                await this.wakeLock.release();
                this.wakeLock = null;
                console.log('Wake Lock released');
            } catch (err) {
                console.debug('Wake Lock release error:', err);
            }
        }
    }
}

// Export for use in other modules or attach to window
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ScreenWakeManager;
} else {
    window.ScreenWakeManager = ScreenWakeManager;
}
