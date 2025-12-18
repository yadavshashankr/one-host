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
        // Scroll handling properties
        this.lastUserGestureTime = 0;
        this.USER_GESTURE_WINDOW_MS = 1000; // 1 second window
        this.scrollTimeout = null;
        this.lastScrollTime = 0;
        this.SCROLL_DEBOUNCE_MS = 500; // Only check every 500ms
    }

    async init() {
        // Setup Wake Lock API if supported
        if (this.isSupported) {
            this.setupWakeLock();
            this.setupScrollHandling();
        }
        
        // Check page readiness (especially important for iOS)
        if (this.isIOS()) {
            if (document.visibilityState !== 'visible' || !document.hasFocus()) {
                console.log('⚠️ Page not ready - Wake Lock will activate on first touch (iOS)');
            }
        }
        
        // Track initialization (Analytics is global)
        if (typeof Analytics !== 'undefined') {
            Analytics.track('screen_wake_initialized', {
                wake_lock_supported: this.isSupported,
                is_ios: this.isIOS(),
                device_type: Analytics.getDeviceType(),
                page_visible: document.visibilityState === 'visible',
                page_focused: document.hasFocus()
            });
        }
    }

    // Record when user gesture occurs (for scroll handling)
    recordUserGesture() {
        this.lastUserGestureTime = Date.now();
    }
    
    // Check if we have a recent user gesture
    hasRecentUserGesture() {
        return (Date.now() - this.lastUserGestureTime) < this.USER_GESTURE_WINDOW_MS;
    }

    async activateFromUserInteraction(source = 'touch') {
        // Always set this flag on any user interaction
        if (!this.activatedByTouch) {
            this.activatedByTouch = true;
        }
        
        // Record the user gesture (for scroll handling)
        this.recordUserGesture();
        
        // On iOS, ensure page is visible and focused before requesting
        if (this.isSupported && !this.wakeLock) {
            if (this.isIOS()) {
                // Wait for page to be visible and focused
                if (document.visibilityState !== 'visible' || !document.hasFocus()) {
                    console.log('⚠️ Waiting for page to be visible/focused before requesting Wake Lock (iOS)');
                    // Set flag to request on next touch or when page becomes ready
                    this.pendingWakeLockRequest = true;
                    this.isActive = true; // Still mark as active
                    return;
                }
            }
            
            await this.requestWakeLock();
        }
        
        this.isActive = true;
        console.log(`✅ Screen wake activated via ${source}`);
        
        // Track activation
        if (typeof Analytics !== 'undefined') {
            Analytics.track('screen_wake_activated', {
                activation_source: source,
                wake_lock_active: !!this.wakeLock
            });
        }
    }
    
    // Keep backward compatibility
    async activateFromTouch() {
        return this.activateFromUserInteraction('touch');
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
                // On iOS, also check focus
                if (this.isIOS()) {
                    if (!document.hasFocus()) {
                        this.pendingWakeLockRequest = true;
                        console.log('⚠️ Wake Lock pending - waiting for focus (iOS requirement)');
                        return;
                    }
                    // Page is visible and focused, but still needs user interaction
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
        
        // Handle focus changes (iOS requirement)
        window.addEventListener('focus', async () => {
            if (this.isIOS() && this.isActive && !this.wakeLock && this.pendingWakeLockRequest) {
                // Page now has focus, but still needs user interaction
                console.log('✅ Page focused - Wake Lock will be requested on next touch (iOS)');
            }
        });
        
        // Re-request on user interaction (iOS requirement)
        ['click', 'touchstart', 'mousedown'].forEach(event => {
            document.addEventListener(event, () => {
                // Record gesture for scroll handling
                this.recordUserGesture();
                
                // Handle pending requests
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
    
    setupScrollHandling() {
        window.addEventListener('scroll', () => {
            const now = Date.now();
            
            // Debounce scroll events
            if (now - this.lastScrollTime < this.SCROLL_DEBOUNCE_MS) {
                return;
            }
            this.lastScrollTime = now;
            
            // Clear existing timeout
            if (this.scrollTimeout) {
                clearTimeout(this.scrollTimeout);
            }
            
            // Check if we need to re-request wake lock
            this.scrollTimeout = setTimeout(() => {
                if (this.isActive && !this.wakeLock && this.isSupported) {
                    // Wake lock was released, but we're still active
                    // On iOS, we need a recent user gesture
                    if (this.isIOS()) {
                        if (this.hasRecentUserGesture()) {
                            // Set pending flag - next touch will re-request
                            this.pendingWakeLockRequest = true;
                            console.log('⚠️ Wake Lock needs re-request - scroll detected (will request on next touch)');
                        }
                    } else {
                        // On non-iOS, try to re-request immediately
                        this.requestWakeLock().catch(() => {
                            this.pendingWakeLockRequest = true;
                        });
                    }
                }
            }, 100); // Small delay to batch rapid scrolls
        }, { passive: true });
    }

    async requestWakeLock() {
        if (!this.isSupported || this.wakeLock) return false;

        // iOS Safari requires page to be visible and focused
        if (this.isIOS()) {
            if (document.visibilityState !== 'visible') {
                console.warn('Wake Lock: Page not visible (iOS requirement)');
                return false;
            }
            
            // Check if page has focus (iOS requirement)
            if (!document.hasFocus()) {
                console.warn('Wake Lock: Page not focused (iOS requirement)');
                return false;
            }
        }

        try {
            this.wakeLock = await navigator.wakeLock.request('screen');
            this.wakeLock.addEventListener('release', () => {
                console.log('Wake Lock released by system');
                this.wakeLock = null;
                // Re-request if still active (requires user interaction on iOS)
                if (this.isActive && document.visibilityState === 'visible') {
                    if (this.isIOS()) {
                        // Also check focus
                        if (!document.hasFocus()) {
                            this.pendingWakeLockRequest = true;
                            console.log('⚠️ Wake Lock released - waiting for focus (iOS)');
                            return;
                        }
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
                requires_user_interaction: err.name === 'NotAllowedError',
                page_visible: document.visibilityState === 'visible',
                page_focused: document.hasFocus()
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
