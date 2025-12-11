#!/usr/bin/env node

/**
 * Cache Busting Script for One-Host
 * Generates a version hash from git commit and injects it into index.html file URLs
 * Usage: node generate-cache-bust.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const INDEX_HTML_PATH = path.join(__dirname, 'index.html');

/**
 * Get git commit hash (short version)
 * Falls back to timestamp if git is not available
 */
function getVersionHash() {
    try {
        // Get short git commit hash (7 characters)
        const hash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
        if (hash && hash.length > 0) {
            console.log(`✅ Using git commit hash: ${hash}`);
            return hash;
        }
    } catch (error) {
        console.warn('⚠️  Git not available or not a git repository, using timestamp fallback');
    }
    
    // Fallback to timestamp if git fails
    const timestamp = Date.now().toString(36); // Base36 encoding for shorter string
    console.log(`⚠️  Using timestamp fallback: ${timestamp}`);
    return timestamp;
}

/**
 * Update index.html with version query parameters
 */
function updateIndexHtml(versionHash) {
    try {
        // Read index.html
        let content = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
        const originalContent = content;
        
        // Replacement patterns: handle both single and double quotes, and existing version params
        const replacements = [
            // style.css - handle href="style.css" or href='style.css', with or without existing ?v=
            {
                pattern: /(<link[^>]*href=["'])(style\.css)(\?v=[\w\d]+)?(["'][^>]*>)/gi,
                replacement: `$1$2?v=${versionHash}$4`
            },
            // constants.js - handle src="js/config/constants.js" or src='js/config/constants.js', with or without existing ?v=
            {
                pattern: /(<script[^>]*src=["'])(js\/config\/constants\.js)(\?v=[\w\d]+)?(["'][^>]*>)/gi,
                replacement: `$1$2?v=${versionHash}$4`
            },
            // script.js - handle src="script.js" or src='script.js', with or without existing ?v=
            {
                pattern: /(<script[^>]*src=["'])(script\.js)(\?v=[\w\d]+)?(["'][^>]*>)/gi,
                replacement: `$1$2?v=${versionHash}$4`
            }
        ];
        
        // Apply all replacements
        replacements.forEach(({ pattern, replacement }) => {
            content = content.replace(pattern, replacement);
        });
        
        // Check if content was updated
        if (content !== originalContent) {
            // Write updated content back to file
            fs.writeFileSync(INDEX_HTML_PATH, content, 'utf8');
            console.log(`✅ Updated index.html with version hash: ${versionHash}`);
            return true;
        } else {
            console.log(`ℹ️  No changes needed in index.html (already has version or files not found)`);
            return false;
        }
        
    } catch (error) {
        console.error(`❌ Error updating index.html:`, error.message);
        process.exit(1);
    }
}

/**
 * Main function
 */
function main() {
    console.log('🔧 Generating cache bust version...');
    
    // Get version hash
    const versionHash = getVersionHash();
    
    // Update index.html
    updateIndexHtml(versionHash);
    
    console.log(`✅ Cache busting completed with version: ${versionHash}`);
    
    // Return hash for use in deploy script
    return versionHash;
}

// Run if called directly
if (require.main === module) {
    main();
}

// Export for use in other scripts
module.exports = { getVersionHash, updateIndexHtml };

