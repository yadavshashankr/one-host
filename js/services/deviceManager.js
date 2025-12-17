// Device Manager Service
// Handles device detection and classification

class DeviceManager {
    constructor() {
        this.userAgent = navigator.userAgent.toLowerCase();
        this.cachedResults = {}; // Cache detection results for performance
    }

    // Check if device is mobile or tablet (not desktop/laptop)
    isMobileOrTablet() {
        // Check cache first
        if (this.cachedResults.isMobileOrTablet !== undefined) {
            return this.cachedResults.isMobileOrTablet;
        }

        // Check for mobile/tablet user agents
        const mobilePattern = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i;
        const isMobileUA = mobilePattern.test(this.userAgent);
        
        // Check for touch capability
        const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        
        // Exclude desktop browsers explicitly
        const isDesktopUA = /windows|macintosh|linux/i.test(this.userAgent) && 
                           !/android|iphone|ipad|ipod/i.test(this.userAgent);
        
        // Special case: iPad on macOS (Safari reports as Mac)
        const isIPadOnMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
        
        // Return true if mobile/tablet UA and not desktop, or if iPad on Mac, or if touch-enabled and not desktop
        const result = isMobileUA || isIPadOnMac || (hasTouch && !isDesktopUA);
        
        // Cache the result
        this.cachedResults.isMobileOrTablet = result;
        
        return result;
    }

    // Check if device is iOS
    isIOS() {
        if (this.cachedResults.isIOS !== undefined) {
            return this.cachedResults.isIOS;
        }
        
        const result = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                     (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        
        this.cachedResults.isIOS = result;
        return result;
    }

    // Check if device is Android
    isAndroid() {
        if (this.cachedResults.isAndroid !== undefined) {
            return this.cachedResults.isAndroid;
        }
        
        const result = /android/i.test(this.userAgent);
        this.cachedResults.isAndroid = result;
        return result;
    }

    // Check if device is desktop/laptop
    isDesktop() {
        if (this.cachedResults.isDesktop !== undefined) {
            return this.cachedResults.isDesktop;
        }
        
        const result = !this.isMobileOrTablet();
        this.cachedResults.isDesktop = result;
        return result;
    }

    // Get device type string
    getDeviceType() {
        if (this.cachedResults.deviceType !== undefined) {
            return this.cachedResults.deviceType;
        }
        
        let deviceType = 'unknown';
        if (this.isIOS()) {
            deviceType = 'ios';
        } else if (this.isAndroid()) {
            deviceType = 'android';
        } else if (this.isDesktop()) {
            deviceType = 'desktop';
        }
        
        this.cachedResults.deviceType = deviceType;
        return deviceType;
    }

    // Check if device has touch capability
    hasTouch() {
        return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    }

    // Clear cache (useful for testing or if user agent changes)
    clearCache() {
        this.cachedResults = {};
    }
}

// Export for use in other modules or attach to window
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DeviceManager;
} else {
    window.DeviceManager = DeviceManager;
}

