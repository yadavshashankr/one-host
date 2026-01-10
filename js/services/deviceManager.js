// Device Manager Service
// Handles device detection and classification

class DeviceManager {
    constructor() {
        this.userAgent = navigator.userAgent.toLowerCase();
        this.cachedResults = {}; // Cache detection results for performance
    }

    // Get screen information for detection
    getScreenInfo() {
        return {
            width: screen.width,
            height: screen.height,
            availWidth: screen.availWidth,
            availHeight: screen.availHeight,
            pixelRatio: window.devicePixelRatio || 1,
            viewportWidth: window.innerWidth || document.documentElement.clientWidth,
            viewportHeight: window.innerHeight || document.documentElement.clientHeight,
            hasTouch: this.hasTouch(),
            maxTouchPoints: navigator.maxTouchPoints || 0
        };
    }

    // Check if screen size suggests tablet/mobile
    isTabletByScreenSize() {
        const screenInfo = this.getScreenInfo();
        const minDimension = Math.min(screenInfo.width, screenInfo.height);
        const maxDimension = Math.max(screenInfo.width, screenInfo.height);
        const aspectRatio = maxDimension / minDimension;
        
        // Tablets typically have:
        // - Smaller screens than desktops (< 1920px on smaller side)
        // - Aspect ratio between 1.3 and 2.5 (portrait/landscape)
        // - Pixel ratio often > 1 (retina/high-DPI)
        
        const isSmallScreen = maxDimension < 1920; // Desktop monitors are usually >= 1920px
        const isTabletAspectRatio = aspectRatio >= 1.3 && aspectRatio <= 2.5;
        const hasHighDPI = screenInfo.pixelRatio > 1;
        
        return isSmallScreen && (isTabletAspectRatio || hasHighDPI);
    }

    // Check viewport dimensions (more reliable than screen for responsive design)
    isTabletByViewport() {
        const screenInfo = this.getScreenInfo();
        const minViewport = Math.min(screenInfo.viewportWidth, screenInfo.viewportHeight);
        const maxViewport = Math.max(screenInfo.viewportWidth, screenInfo.viewportHeight);
        
        // Tablets typically have viewport:
        // - Between 600px and 1200px on smaller dimension
        // - Max dimension <= 1600px
        return minViewport >= 600 && minViewport <= 1200 && maxViewport <= 1600;
    }

    // Check if device is mobile or tablet (not desktop/laptop)
    isMobileOrTablet() {
        // Check cache first
        if (this.cachedResults.isMobileOrTablet !== undefined) {
            return this.cachedResults.isMobileOrTablet;
        }

        // Method 1: User Agent Detection (Primary)
        const mobilePattern = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i;
        const isMobileUA = mobilePattern.test(this.userAgent);
        
        // Method 2: Check for Android specifically (even without "mobile")
        const isAndroid = /android/i.test(this.userAgent);
        
        // Method 3: Screen Size Detection (Secondary)
        const isTabletByScreen = this.isTabletByScreenSize();
        
        // Method 4: Viewport Detection (Tertiary)
        const isTabletByViewport = this.isTabletByViewport();
        
        // Method 5: Touch Capability
        const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        
        // Method 6: Exclude desktop browsers explicitly
        const isDesktopUA = /windows|macintosh|linux/i.test(this.userAgent) && 
                           !/android|iphone|ipad|ipod/i.test(this.userAgent);
        
        // Method 7: iPad on macOS (Safari reports as Mac)
        const isIPadOnMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
        
        // Combined logic:
        // - Mobile UA (includes Android phones)
        // - Android UA (catches Android tablets even without "mobile")
        // - iPad on Mac
        // - Tablet by screen size AND has touch (catches Android tablets)
        // - Tablet by viewport AND has touch (catches Android tablets)
        // - Touch-enabled but NOT desktop UA
        const result = isMobileUA || 
                       (isAndroid && hasTouch) || // Android devices (phones + tablets)
                       isIPadOnMac || 
                       (isTabletByScreen && hasTouch) || 
                       (isTabletByViewport && hasTouch) || 
                       (hasTouch && !isDesktopUA);
        
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

    // Check if device is specifically a tablet (not phone)
    isTablet() {
        if (this.cachedResults.isTablet !== undefined) {
            return this.cachedResults.isTablet;
        }
        
        const screenInfo = this.getScreenInfo();
        const minDimension = Math.min(screenInfo.width, screenInfo.height);
        
        // Tablets typically have larger screens than phones
        // Phones: usually < 600px on smaller dimension
        // Tablets: usually >= 600px on smaller dimension
        const result = this.isMobileOrTablet() && minDimension >= 600;
        
        this.cachedResults.isTablet = result;
        return result;
    }

    // Check if device is iPadOS Safari tablet (specifically for Safari on iPad)
    isIPadOSSafariTablet() {
        if (this.cachedResults.isIPadOSSafariTablet !== undefined) {
            return this.cachedResults.isIPadOSSafariTablet;
        }
        
        // Must be iOS (iPad)
        if (!this.isIOS()) {
            this.cachedResults.isIPadOSSafariTablet = false;
            return false;
        }
        
        // Must be a tablet (not iPhone)
        if (!this.isTablet()) {
            this.cachedResults.isIPadOSSafariTablet = false;
            return false;
        }
        
        // Must be Safari browser (not Chrome or other browsers)
        // Safari on iPad can report as either:
        // 1. User agent contains "Safari" but NOT "Chrome" or "CriOS" or "FxiOS" or "OPiOS"
        // 2. iPad on macOS (iPadOS 13+) reports as MacIntel with touch points > 1
        const ua = navigator.userAgent;
        const isSafariUA = /Safari/i.test(ua) && 
                          !/Chrome|CriOS|FxiOS|OPiOS|EdgiOS/i.test(ua);
        
        // iPadOS 13+ detection: MacIntel platform with touch points (Safari only)
        const isIPadOnMac = navigator.platform === 'MacIntel' && 
                           navigator.maxTouchPoints > 1 && 
                           isSafariUA;
        
        // Traditional iPad detection: User agent contains "iPad" or viewport-based detection
        const isIPadUA = /iPad/i.test(ua);
        
        // Check if it's actually Safari (not other browsers on iPad)
        const result = (isIPadUA || isIPadOnMac) && isSafariUA;
        
        this.cachedResults.isIPadOSSafariTablet = result;
        return result;
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

