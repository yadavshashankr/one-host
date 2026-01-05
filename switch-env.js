#!/usr/bin/env node

// Simple Environment Switcher for One-Host
// Usage: node switch-env.js [dev|prod|pro]

const fs = require('fs');
const path = require('path');

const ENVIRONMENTS = {
    dev: 'development',
    prod: 'production',
    pro: 'pro'
};

const CONFIG_FILE = 'js/config/constants.js';

function switchEnvironment(env) {
    if (!ENVIRONMENTS[env]) {
        console.error('❌ Invalid environment. Use "dev", "prod", or "pro"');
        console.log('Usage: node switch-env.js [dev|prod|pro]');
        process.exit(1);
    }

    const targetEnv = ENVIRONMENTS[env];
    
    try {
        // Read the current config file
        let content = fs.readFileSync(CONFIG_FILE, 'utf8');
        
        // Replace the environment variable
        const newContent = content.replace(
            /const CURRENT_ENVIRONMENT = ['"]\w+['"];/,
            `const CURRENT_ENVIRONMENT = '${targetEnv}';`
        );
        
        // Write back to file
        fs.writeFileSync(CONFIG_FILE, newContent);
        
        console.log(`✅ Switched to ${targetEnv} environment`);
        console.log(`📁 Updated: ${CONFIG_FILE}`);
        
        // Show the URLs for this environment
        const urls = {
            development: 'https://yadavshashankr.github.io/one-host-develop/',
            production: 'https://one-host.app/',
            pro: 'https://yadavshashankr.github.io/one-host-pro/'
        };
        
        const githubUrls = {
            development: 'https://github.com/yadavshashankr/one-host-develop.git',
            production: 'https://github.com/yadavshashankr/one-host.git',
            pro: 'https://github.com/yadavshashankr/one-host-pro.git'
        };
        
        console.log(`🌐 Base URL: ${urls[targetEnv]}`);
        console.log(`📦 GitHub Repo: ${githubUrls[targetEnv]}`);
        
    } catch (error) {
        console.error('❌ Error switching environment:', error.message);
        process.exit(1);
    }
}

// Get environment from command line argument
const env = process.argv[2];

if (!env) {
    console.log('🔧 One-Host Environment Switcher');
    console.log('');
    console.log('Usage: node switch-env.js [dev|prod|pro]');
    console.log('');
    console.log('Examples:');
    console.log('  node switch-env.js dev   # Switch to development');
    console.log('  node switch-env.js prod  # Switch to production');
    console.log('  node switch-env.js pro   # Switch to pro');
    console.log('');
    console.log('After switching, commit and push to deploy:');
    console.log('  git add . && git commit -m "Switch to [env]" && git push');
    console.log('');
    console.log('Repository URLs:');
    console.log('  Development: https://github.com/yadavshashankr/one-host-develop.git');
    console.log('  Production:  https://github.com/yadavshashankr/one-host.git');
    console.log('  Pro:         https://github.com/yadavshashankr/one-host-pro.git');
    process.exit(0);
}

switchEnvironment(env); 