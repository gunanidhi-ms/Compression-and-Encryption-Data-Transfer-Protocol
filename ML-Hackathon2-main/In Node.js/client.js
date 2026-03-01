const https = require('https');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { sendFile } = require('./sender/sender');
const { generateKeyPair, getPublicBytes, deriveSessionKey } = require('./shared/crypto');

function log(msg) {
    process.stdout.write(msg + "\n");
}

// Generate key fingerprint from shared secret for MitM detection
function computeFingerprint(sharedSecret) {
    return crypto.createHash('sha256')
        .update(sharedSecret)
        .digest('hex')
        .substring(0, 8)
        .toUpperCase()
        .match(/.{4}/g)
        .join('-');
}

function httpsPost(host, port, urlPath, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const data = typeof body === 'string' ? body : (Buffer.isBuffer(body) ? body : JSON.stringify(body));
        const isBuffer = Buffer.isBuffer(data);

        const options = {
            hostname: host,
            port: port,
            path: urlPath,
            method: 'POST',
            rejectUnauthorized: false, // self-signed cert
            headers: {
                'Content-Type': isBuffer ? 'application/octet-stream' : 'application/json',
                'Content-Length': Buffer.byteLength(data),
                ...headers
            }
        };

        const req = https.request(options, (res) => {
            let responseBody = [];
            res.on('data', (chunk) => responseBody.push(chunk));
            res.on('end', () => {
                const raw = Buffer.concat(responseBody);
                resolve({ statusCode: res.statusCode, body: raw, json: () => JSON.parse(raw.toString()) });
            });
        });

        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function startClient(inputPath, host = 'localhost', port = 8888, pin = null) {

    log(`\n🔗 Connecting to ${host}:${port} (HTTPS)...`);
    if (pin) log(`🔑 Using PIN: ${pin}`);

    try {
        // --- PHASE 1: HANDSHAKE ---
        log('\n--- Phase 1: Key Exchange (ECDH X25519) ---');

        const clientKeyPair = generateKeyPair();
        const clientPublicKeyBytes = getPublicBytes(clientKeyPair);

        const handshakePayload = {
            pin: pin || '',
            publicKey: clientPublicKeyBytes.toString('hex')
        };

        const handshakeRes = await httpsPost(host, port, '/handshake', handshakePayload);

        if (handshakeRes.statusCode === 403) {
            log('❌ PIN rejected by receiver. Check your PIN and try again.');
            throw new Error('PIN mismatch');
        }

        if (handshakeRes.statusCode !== 200) {
            throw new Error(`Handshake failed with status ${handshakeRes.statusCode}`);
        }

        const handshakeData = handshakeRes.json();
        const serverPublicKeyBytes = Buffer.from(handshakeData.publicKey, 'hex');
        const sessionId = handshakeData.sessionId;

        const sessionKey = deriveSessionKey(clientKeyPair.privateKey, serverPublicKeyBytes);

        // Compute and display key fingerprint
        const fingerprint = computeFingerprint(sessionKey);

        log('✅ Handshake successful. Session established.');
        log(`   Session ID: ${sessionId.substring(0, 8)}...`);
        log(`🔐 Verification Code: ${fingerprint}`);
        log(`   Confirm this matches the receiver's code.`);

        // Verify fingerprint matches server's computation
        if (handshakeData.fingerprint && handshakeData.fingerprint !== fingerprint) {
            log('🚨 WARNING: Verification codes DO NOT match!');
            log('   This may indicate a man-in-the-middle attack. Aborting.');
            throw new Error('Key fingerprint mismatch — possible MitM attack');
        }

        // --- PHASE 2: COMPRESS + ENCRYPT ---
        log('\n--- Phase 2: Compress & Encrypt ---');
        log(`📦 Processing: ${inputPath}`);

        const tempDir = path.join(require('os').tmpdir(), 'cetp-client');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
        const tempFile = path.join(tempDir, `payload_${Date.now()}.bin`);

        const stats = await sendFile(inputPath, tempFile, sessionKey, 'zstd');

        log('\n--- Sender Summary ---');
        log(`Original Size: ${(stats.originalTotal / (1024 * 1024)).toFixed(2)} MB`);
        log(`Encrypted Size: ${(stats.encryptedTotal / (1024 * 1024)).toFixed(2)} MB`);
        log(`Compression Ratio: ${stats.ratio.toFixed(2)}%`);
        log(`Processing Time: ${stats.totalTime.toFixed(2)}s`);

        // --- PHASE 3: TRANSFER ---
        log('\n--- Phase 3: Network Transfer (HTTPS) ---');
        log(`📤 Sending encrypted payload to ${host}:${port}...`);

        const payload = fs.readFileSync(tempFile);
        log(`   Payload size: ${(payload.length / (1024 * 1024)).toFixed(2)} MB`);

        const transferRes = await httpsPost(host, port, '/transfer', payload, {
            'X-Session-Id': sessionId
        });

        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);

        if (transferRes.statusCode !== 200) {
            const errData = transferRes.json();
            throw new Error(`Transfer failed: ${errData.error || 'Unknown error'}`);
        }

        const result = transferRes.json();

        // --- PHASE 4: VERIFICATION ---
        log('\n--- Phase 4: Verification ---');

        if (result.status === 'success') {
            log('✅ TRANSFER SUCCESSFUL');
            log('   All files verified (SHA-256 + AES-256-GCM)');
            if (result.verification) {
                result.verification.forEach(v => {
                    log(`   ✔ ${v.file}: ${v.verification}`);
                });
            }
        } else {
            log('⚠️ TRANSFER COMPLETED WITH ISSUES');
        }

        log('\n✨ Secure Transfer Complete.\n');

    } catch (err) {
        log(`\n❌ ERROR: ${err.message}\n`);
        throw err;
    }
}

// CLI
if (require.main === module) {
    const input = process.argv[2];
    const host = process.argv[3] || 'localhost';
    const port = parseInt(process.argv[4]) || 8888;
    const pin = process.argv[5] || null;

    if (input) {
        startClient(input, host, port, pin).catch(() => process.exit(1));
    } else {
        console.log("Usage: node client.js <file_or_folder> <host> <port> [pin]");
    }
}

module.exports = { startClient };
