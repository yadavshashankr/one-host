// Bulk Download Manager Service
// Orchestrates memory-aware bulk file downloads with ZIP part splitting

class BulkDownloadManager {
    constructor(memoryMonitor, zipPartManager) {
        this.memoryMonitor = memoryMonitor;
        this.zipPartManager = zipPartManager;
        this.MEMORY_THRESHOLD = 60; // Start splitting at 60% (more aggressive)
        this.MEMORY_SAFETY_LIMIT = 75; // Hard limit at 75% (before JSZip fails)
        this.MAX_FILES_PER_PART = 10; // Maximum files per ZIP part (safety limit)
    }

    // Main method to download all files with memory-aware ZIP part splitting
    async downloadAllFiles(fileItems, options = {}) {
        const {
            receivedFileInfoMap,
            requestBlobFromPeer,
            showOrUpdateProgressNotification,
            downloadBlob,
            activeBlobURLs
        } = options;

        if (!receivedFileInfoMap || !requestBlobFromPeer) {
            throw new Error('Required dependencies not provided');
        }

        // Check if JSZip is available
        if (!this.zipPartManager.isAvailable()) {
            throw new Error('JSZip library not loaded');
        }

        // Convert NodeList to Array
        const fileItemsArray = Array.from(fileItems);
        
        if (fileItemsArray.length === 0) {
            return {
                successCount: 0,
                errors: [],
                partsCreated: 0,
                successfulFileIds: new Set()
            };
        }

        // Log initial memory
        this.memoryMonitor.logMemoryStatus('before bulk download');

        // Initialize tracking variables
        let totalCompleted = 0;
        let totalErrors = [];
        let partNumber = 1;
        let currentBatch = [];
        let currentZip = this.zipPartManager.createZipInstance();
        let currentBatchSize = 0;
        const successfulFileIds = new Set();

        // Process files in batches based on memory constraints
        for (let i = 0; i < fileItemsArray.length; i++) {
            const item = fileItemsArray[i];
            const fileId = item.getAttribute('data-file-id');
            if (!fileId) continue;

            // Get file info from Map
            const fileInfo = receivedFileInfoMap.get(fileId);
            if (!fileInfo) {
                console.warn(`File info not found for file ID: ${fileId}`);
                totalErrors.push(`File ${fileId} not found`);
                continue;
            }

            // Check memory before fetching next file
            const memoryUsage = this.memoryMonitor.getMemoryUsagePercent();
            const shouldCreatePart = memoryUsage !== null && (
                memoryUsage >= this.MEMORY_THRESHOLD || 
                (currentBatch.length > 0 && memoryUsage >= this.MEMORY_SAFETY_LIMIT) ||
                currentBatch.length >= this.MAX_FILES_PER_PART // Safety: max files per part
            );

            // If memory is approaching limit and we have files in current batch, create ZIP part
            if (shouldCreatePart && currentBatch.length > 0) {
                console.log(`📦 Memory at ${memoryUsage}% or ${currentBatch.length} files, creating ZIP part ${partNumber} with ${currentBatch.length} files`);
                
                // Generate and download current ZIP part
                await this.createAndDownloadPart(
                    currentZip,
                    currentBatch,
                    partNumber,
                    fileItemsArray.length,
                    totalCompleted,
                    showOrUpdateProgressNotification,
                    downloadBlob
                );

                // Clear memory: delete ZIP instance and revoke blob URLs
                this.zipPartManager.cleanupZipInstance(currentZip);
                currentZip = this.zipPartManager.createZipInstance(); // Create new instance for next batch
                currentBatch = [];
                currentBatchSize = 0;
                partNumber++;

                // Longer delay to allow memory cleanup and garbage collection
                await new Promise(resolve => setTimeout(resolve, 300));

                // Log memory after cleanup
                this.memoryMonitor.logMemoryStatus(`after ZIP part ${partNumber - 1} cleanup`);
            }

            try {
                // Update progress
                if (showOrUpdateProgressNotification) {
                    showOrUpdateProgressNotification(
                        'downloading', 
                        totalCompleted, 
                        fileItemsArray.length, 
                        `downloading (part ${partNumber})`
                    );
                }

                // Request blob from peer
                const blob = await requestBlobFromPeer(fileInfo);
                
                // Check memory after fetching blob
                const memoryAfterFetch = this.memoryMonitor.getMemoryUsagePercent();
                if (memoryAfterFetch !== null && memoryAfterFetch >= this.MEMORY_SAFETY_LIMIT) {
                    console.warn(`⚠️ Memory at ${memoryAfterFetch}% after fetching ${fileInfo.name}, creating ZIP part now`);
                    
                    // Add current file to batch and create ZIP immediately
                    const fileName = this.zipPartManager.getUniqueFileName(currentZip, fileInfo.name);
                    currentZip.file(fileName, blob, { compression: 'STORE' });
                    currentBatch.push({ fileId, item, fileInfo });
                    currentBatchSize += blob.size;
                    successfulFileIds.add(fileId);
                    totalCompleted++;

                    // Create ZIP part
                    await this.createAndDownloadPart(
                        currentZip,
                        currentBatch,
                        partNumber,
                        fileItemsArray.length,
                        totalCompleted,
                        showOrUpdateProgressNotification,
                        downloadBlob
                    );

                    // Clear and reset
                    this.zipPartManager.cleanupZipInstance(currentZip);
                    currentZip = this.zipPartManager.createZipInstance();
                    currentBatch = [];
                    currentBatchSize = 0;
                    partNumber++;

                    await new Promise(resolve => setTimeout(resolve, 100));
                    continue;
                }

                // Handle duplicate filenames
                const fileName = this.zipPartManager.getUniqueFileName(currentZip, fileInfo.name);
                
                // Add to ZIP with no compression (STORE method)
                currentZip.file(fileName, blob, { compression: 'STORE' });
                currentBatch.push({ fileId, item, fileInfo });
                currentBatchSize += blob.size;
                successfulFileIds.add(fileId);
                totalCompleted++;

                // Check memory AFTER adding to ZIP (critical check)
                const memoryAfterAdd = this.memoryMonitor.getMemoryUsagePercent();
                if (memoryAfterAdd !== null && memoryAfterAdd >= this.MEMORY_SAFETY_LIMIT) {
                    console.warn(`⚠️ Memory at ${memoryAfterAdd}% after adding ${fileInfo.name} to ZIP, creating part now`);
                    
                    // Create ZIP part immediately
                    await this.createAndDownloadPart(
                        currentZip,
                        currentBatch,
                        partNumber,
                        fileItemsArray.length,
                        totalCompleted,
                        showOrUpdateProgressNotification,
                        downloadBlob
                    );

                    // Clear and reset
                    this.zipPartManager.cleanupZipInstance(currentZip);
                    currentZip = this.zipPartManager.createZipInstance();
                    currentBatch = [];
                    currentBatchSize = 0;
                    partNumber++;

                    await new Promise(resolve => setTimeout(resolve, 300));
                }

                // Log memory periodically
                if (totalCompleted % 5 === 0) {
                    this.memoryMonitor.logMemoryStatus(`after processing ${totalCompleted} files`);
                }

            } catch (error) {
                console.error(`Error fetching file ${fileInfo.name}:`, error);
                totalErrors.push(fileInfo.name);
                // Continue with other files
            }
        }

        // Create final ZIP part with remaining files
        if (currentBatch.length > 0) {
            console.log(`📦 Creating final ZIP part ${partNumber} with ${currentBatch.length} files`);
            await this.createAndDownloadPart(
                currentZip,
                currentBatch,
                partNumber,
                fileItemsArray.length,
                totalCompleted,
                showOrUpdateProgressNotification,
                downloadBlob
            );
        }

        // Log final memory
        this.memoryMonitor.logMemoryStatus('after bulk download complete');

        return {
            successCount: totalCompleted,
            errors: totalErrors,
            partsCreated: partNumber,
            successfulFileIds: successfulFileIds
        };
    }

    // Helper method to create and download a ZIP part
    async createAndDownloadPart(zip, batch, partNumber, totalFiles, totalCompleted, showOrUpdateProgressNotification, downloadBlob) {
        // Update progress - creating ZIP part
        if (showOrUpdateProgressNotification) {
            showOrUpdateProgressNotification(
                'downloading', 
                totalCompleted, 
                totalFiles, 
                `creating_zip_part_${partNumber}`
            );
        }

        // Log memory before ZIP generation
        const memoryBeforeZip = this.memoryMonitor.getMemoryUsagePercent();
        this.memoryMonitor.logMemoryStatus(`before generating ZIP part ${partNumber}`);

        // Critical check: If memory is already too high, we might fail
        if (memoryBeforeZip !== null && memoryBeforeZip >= this.MEMORY_SAFETY_LIMIT) {
            console.warn(`⚠️ Memory at ${memoryBeforeZip}% before ZIP generation - this might fail. Consider smaller batches.`);
        }

        try {
            // Generate ZIP blob with no compression
            const zipBlob = await this.zipPartManager.generateZipBlob(zip, {
                type: 'blob',
                compression: 'STORE',
                compressionOptions: null
            });

            // Log memory after ZIP generation
            const memoryAfterZip = this.memoryMonitor.getMemoryUsagePercent();
            const zipSize = this.memoryMonitor.formatBytes(zipBlob.size);
            console.log(`📦 ZIP part ${partNumber} created: ${zipSize} (Memory: ${memoryAfterZip}%)`);

            // Download ZIP part file
            const totalParts = partNumber; // Will be updated as we create more parts
            this.zipPartManager.downloadZipPart(zipBlob, partNumber, totalParts, downloadBlob);

            console.log(`✅ ZIP part ${partNumber} downloaded`);
        } catch (error) {
            // If ZIP generation fails due to memory, try to recover
            if (error.message && error.message.includes('allocation failed')) {
                console.error(`❌ ZIP generation failed due to memory allocation error. Batch size: ${batch.length} files`);
                throw new Error(`Memory allocation failed. Try downloading fewer files at once or use smaller batches. Current batch: ${batch.length} files`);
            }
            throw error;
        }
    }

    // Check if we should create a ZIP part based on memory and batch size
    shouldCreateZipPart(memoryUsage, batchSize, threshold) {
        if (memoryUsage === null) return false; // Can't monitor memory
        return memoryUsage >= threshold || (batchSize > 0 && memoryUsage >= this.MEMORY_SAFETY_LIMIT);
    }

    // Set memory thresholds (for customization)
    setMemoryThresholds(threshold = 60, safetyLimit = 75) {
        this.MEMORY_THRESHOLD = threshold;
        this.MEMORY_SAFETY_LIMIT = safetyLimit;
    }

    // Set maximum files per part
    setMaxFilesPerPart(maxFiles = 10) {
        this.MAX_FILES_PER_PART = maxFiles;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BulkDownloadManager;
}

