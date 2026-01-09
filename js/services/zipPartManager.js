// ZIP Part Manager Service
// Handles ZIP file creation, part management, and download

class ZipPartManager {
    constructor() {
        this.partCounter = 1;
        this.isJSZipAvailable = typeof JSZip !== 'undefined';
        
        if (!this.isJSZipAvailable) {
            console.error('JSZip library not available');
        }
    }

    // Create a new ZIP instance
    createZipInstance() {
        if (!this.isJSZipAvailable) {
            throw new Error('JSZip library not loaded');
        }
        return new JSZip();
    }

    // Get unique file name in ZIP (handle duplicates)
    getUniqueFileName(zip, originalName) {
        let fileName = originalName;
        let counter = 1;
        
        while (zip.file(fileName)) {
            const nameParts = originalName.split('.');
            const ext = nameParts.length > 1 ? '.' + nameParts.pop() : '';
            const baseName = nameParts.join('.');
            fileName = `${baseName} (${counter})${ext}`;
            counter++;
        }
        
        return fileName;
    }

    // Generate ZIP blob from ZIP instance
    async generateZipBlob(zip, options = {}) {
        if (!this.isJSZipAvailable) {
            throw new Error('JSZip library not loaded');
        }

        const defaultOptions = {
            type: 'blob',
            compression: 'STORE', // No compression - maintain file integrity
            compressionOptions: null
        };

        const finalOptions = { ...defaultOptions, ...options };
        
        return await zip.generateAsync(finalOptions);
    }

    // Get timestamp string in yyyymmddhhmmss format (local timezone)
    getTimestampString(date = null) {
        const now = date || new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        return `${year}${month}${day}${hours}${minutes}${seconds}`;
    }

    // Download a ZIP part
    downloadZipPart(zipBlob, partNumber, totalParts = null, downloadBlobFn = null, sharedTimestamp = null) {
        if (!zipBlob) {
            throw new Error('ZIP blob is required');
        }

        // Generate file name with shared timestamp or create new one
        const timestamp = sharedTimestamp || this.getTimestampString();
        let zipFileName;
        
        if (totalParts && totalParts > 1) {
            // Multiple parts: One-Host-1-yyyymmddhhmmss.zip, One-Host-2-yyyymmddhhmmss.zip, etc.
            zipFileName = `One-Host-${partNumber}-${timestamp}.zip`;
        } else if (partNumber > 1) {
            // Single part but numbered: One-Host-1-yyyymmddhhmmss.zip
            zipFileName = `One-Host-${partNumber}-${timestamp}.zip`;
        } else {
            // First part or single file: One-Host-yyyymmddhhmmss.zip
            zipFileName = `One-Host-${timestamp}.zip`;
        }

        // Use provided downloadBlob function, or global, or fallback
        if (downloadBlobFn && typeof downloadBlobFn === 'function') {
            downloadBlobFn(zipBlob, zipFileName, null);
        } else if (typeof downloadBlob === 'function') {
            // Use global downloadBlob function if available
            downloadBlob(zipBlob, zipFileName, null);
        } else {
            // Fallback: create download link manually
            const url = URL.createObjectURL(zipBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = zipFileName;
            a.target = '_self';
            a.rel = 'noopener';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            // Cleanup after a delay
            setTimeout(() => {
                URL.revokeObjectURL(url);
            }, 1000);
        }

        console.log(`📦 ZIP part ${partNumber} downloaded: ${zipFileName} (${this.formatBytes(zipBlob.size)})`);
        return zipFileName;
    }

    // Cleanup ZIP instance (set to null for garbage collection)
    cleanupZipInstance(zip) {
        if (zip) {
            // Clear all files from ZIP
            zip = null;
        }
    }

    // Reset part counter
    resetPartCounter() {
        this.partCounter = 1;
    }

    // Get next part number
    getNextPartNumber() {
        return this.partCounter++;
    }

    // Format bytes to human-readable string
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    // Check if JSZip is available
    isAvailable() {
        return this.isJSZipAvailable;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ZipPartManager;
}

