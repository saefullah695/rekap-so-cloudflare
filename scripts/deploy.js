#!/usr/bin/env node

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🚀 Starting deployment process...');

try {
    // Pastikan wrangler terinstal
    console.log('🧩 Checking Wrangler installation...');
    execSync('npx wrangler --version', { stdio: 'inherit' });

    // Update versi di worker
    console.log('📦 Building application...');
    const rootDir = join(__dirname, '..');
    const pkgPath = join(rootDir, 'package.json');
    const workerPath = join(rootDir, 'worker/main.js');

    if (!existsSync(pkgPath) || !existsSync(workerPath)) {
        throw new Error('package.json atau worker/main.js tidak ditemukan');
    }

    const packageJson = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const workerMain = readFileSync(workerPath, 'utf8');
    const updatedWorker = workerMain.replace(
        /VERSION\s*=\s*"[0-9.]+"/,
        `VERSION = "${packageJson.version}"`
    );
    writeFileSync(workerPath, updatedWorker);

    // Deploy ke Cloudflare
    console.log('☁️ Deploying to Cloudflare Workers...');
    execSync('npx wrangler deploy', { stdio: 'inherit', cwd: rootDir });

    console.log('✅ Deployment completed successfully!');
} catch (error) {
    console.error('❌ Deployment failed:', error.message);
    process.exit(1);
}
