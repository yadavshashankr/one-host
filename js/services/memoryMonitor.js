// Memory Monitor Service
// Monitors browser memory usage and provides memory management utilities

class MemoryMonitor {
    constructor() {
        this.isSupported = typeof performance !== 'undefined' && 
                          typeof performance.memory !== 'undefined';
        
        if (!this.isSupported) {
            console.warn('Memory monitoring not available (Chrome/Edge only)');
        }
    }

    // Get current memory usage information
    getMemoryInfo() {
        if (this.isSupported && performance.memory) {
            return {
                usedJSHeapSize: performance.memory.usedJSHeapSize,
                totalJSHeapSize: performance.memory.totalJSHeapSize,
                jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
                available: performance.memory.jsHeapSizeLimit - performance.memory.usedJSHeapSize,
                usedPercent: (performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit * 100).toFixed(2)
            };
        }
        return null;
    }

    // Get memory usage as a percentage
    getMemoryUsagePercent() {
        const mem = this.getMemoryInfo();
        return mem ? parseFloat(mem.usedPercent) : null;
    }

    // Check if memory is approaching the specified threshold
    isMemoryApproachingLimit(threshold = 70) {
        const usage = this.getMemoryUsagePercent();
        if (usage === null) return false; // Can't monitor, assume OK
        return usage >= threshold;
    }

    // Format bytes to human-readable string
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    // Log memory status with context
    logMemoryStatus(context = '') {
        const mem = this.getMemoryInfo();
        if (mem) {
            const contextStr = context ? ` ${context}` : '';
            console.log(`💾 Memory${contextStr}:`, {
                used: this.formatBytes(mem.usedJSHeapSize),
                total: this.formatBytes(mem.totalJSHeapSize),
                limit: this.formatBytes(mem.jsHeapSizeLimit),
                available: this.formatBytes(mem.available),
                usedPercent: `${mem.usedPercent}%`
            });
            return mem;
        } else {
            if (context) {
                console.log(`💾 Memory monitoring not available (Chrome/Edge only)${context}`);
            }
            return null;
        }
    }

    // Check if memory usage is high and log warning
    checkMemoryWarning(threshold = 80) {
        const mem = this.getMemoryInfo();
        if (mem && parseFloat(mem.usedPercent) > threshold) {
            console.warn(`⚠️ High memory usage: ${mem.usedPercent}% used (threshold: ${threshold}%)`);
            return true;
        }
        return false;
    }

    // Get detailed memory report for analytics
    getMemoryReport() {
        const mem = this.getMemoryInfo();
        if (!mem) return null;

        return {
            usedJSHeapSize: mem.usedJSHeapSize,
            totalJSHeapSize: mem.totalJSHeapSize,
            jsHeapSizeLimit: mem.jsHeapSizeLimit,
            available: mem.available,
            usedPercent: parseFloat(mem.usedPercent),
            usedFormatted: this.formatBytes(mem.usedJSHeapSize),
            totalFormatted: this.formatBytes(mem.totalJSHeapSize),
            limitFormatted: this.formatBytes(mem.jsHeapSizeLimit),
            availableFormatted: this.formatBytes(mem.available)
        };
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MemoryMonitor;
}

