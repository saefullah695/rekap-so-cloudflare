#!/usr/bin/env node

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🚀 Starting deployment process...');

try {
    // Build process
    console.log('📦 Building application...');
    
    // Update version in worker
    const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));
    const workerMain = readFileSync(join(__dirname, '../worker/main.js'), 'utf8');
    const updatedWorker = workerMain.replace(/VERSION = "[\d.]+"/, `VERSION = "${packageJson.version}"`);
    writeFileSync(join(__dirname, '../worker/main.js'), updatedWorker);
    
    // Deploy to Cloudflare
    console.log('☁️ Deploying to Cloudflare Workers...');
    execSync('wrangler deploy', { stdio: 'inherit', cwd: join(__dirname, '..') });
    
    console.log('✅ Deployment completed successfully!');
} catch (error) {
    console.error('❌ Deployment failed:', error.message);
    process.exit(1);
}
