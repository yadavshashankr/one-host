// Screen Wake Manager Service
// Keeps screen on during active use using Wake Lock API and video fallback

class ScreenWakeManager {
    constructor() {
        this.wakeLock = null;
        this.video = null;
        this.isSupported = 'wakeLock' in navigator;
        this.isActive = false;
        this.activatedByTouch = false;
        this.activatedByConnection = false;
        this.videoPath = './assets/blank.mp4';
    }

    async init() {
        // Setup video fallback (always needed)
        this.setupVideoFallback();
        
        // Setup Wake Lock API if supported
        if (this.isSupported) {
            this.setupWakeLock();
        }
        
        // Track initialization (Analytics is global)
        if (typeof Analytics !== 'undefined') {
            Analytics.track('screen_wake_initialized', {
                wake_lock_supported: this.isSupported,
                device_type: Analytics.getDeviceType()
            });
        }
    }

    async activateFromTouch() {
        if (!this.activatedByTouch) {
            this.activatedByTouch = true;
            await this.start('touch');
        }
    }

    async activateFromConnection() {
        if (!this.activatedByConnection) {
            this.activatedByConnection = true;
            await this.start('connection');
        }
    }

    async start(activationSource = 'unknown') {
        if (this.isActive) return;

        // Try Wake Lock API first
        if (this.isSupported && !this.wakeLock) {
            await this.requestWakeLock();
        }

        // Start video if not playing
        if (this.video && this.video.paused) {
            await this.startVideo();
        }

        this.isActive = true;
        console.log('✅ Screen wake activated via', activationSource);

        // Track activation
        if (typeof Analytics !== 'undefined') {
            Analytics.track('screen_wake_activated', {
                activation_source: activationSource,
                wake_lock_active: !!this.wakeLock,
                video_fallback_active: !!(this.video && !this.video.paused)
            });
        }
    }

    async stop() {
        if (!this.isActive) return;

        // Release wake lock
        if (this.wakeLock) {
            await this.releaseWakeLock();
        }

        // Stop video
        if (this.video && !this.video.paused) {
            this.video.pause();
        }

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

    async setupWakeLock() {
        // Handle visibility changes - re-request wake lock when page becomes visible
        document.addEventListener('visibilitychange', async () => {
            if (document.visibilityState === 'visible' && this.isActive && !this.wakeLock) {
                try {
                    await this.requestWakeLock();
                } catch (err) {
                    console.debug('Failed to re-request wake lock:', err);
                }
            }
        });
    }

    setupVideoFallback() {
        if (this.video) return;

        const video = document.createElement('video');
        video.id = 'keepAwakeVideo';
        video.width = 1;
        video.height = 1;
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.style.cssText = 'position: fixed; top: -9999px; opacity: 0; pointer-events: none;';
        video.src = this.videoPath;

        // Keep playing if paused
        video.addEventListener('pause', () => {
            if (this.isActive && video.paused) {
                video.play().catch(() => {});
            }
        });

        document.body.appendChild(video);
        this.video = video;
    }

    async requestWakeLock() {
        if (!this.isSupported || this.wakeLock) return;

        try {
            this.wakeLock = await navigator.wakeLock.request('screen');
            this.wakeLock.addEventListener('release', () => {
                console.log('Wake Lock released by system');
                this.wakeLock = null;
            });
            console.log('✅ Wake Lock API active');
        } catch (err) {
            console.debug('Wake Lock request failed:', err);
            this.wakeLock = null;
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

    async startVideo() {
        if (!this.video) return;

        try {
            await this.video.play();
            console.log('✅ Video fallback active');
        } catch (err) {
            console.debug('Video play failed (will retry on interaction):', err);
        }
    }
}

// Export for use in other modules or attach to window
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ScreenWakeManager;
} else {
    window.ScreenWakeManager = ScreenWakeManager;
}

