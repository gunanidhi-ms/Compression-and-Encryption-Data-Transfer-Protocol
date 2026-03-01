const https = require('https');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const selfsigned = require('selfsigned');
const { receiveFile } = require('./receiver/receiver');
const { generateKeyPair, getPublicBytes, deriveSessionKey } = require('./shared/crypto');

const sessions = new Map();

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

function startServer(port = 8888, pin = null, host = '0.0.0.0', outputFolder = null) {
    const OUTPUT_FOLDER = outputFolder || path.join(__dirname, 'received_files');

    if (!fs.existsSync(OUTPUT_FOLDER)) {
        fs.mkdirSync(OUTPUT_FOLDER, { recursive: true });
    }

    // Generate self-signed TLS certificate (pure JS, no OpenSSL)
    log('[TLS] Generating self-signed certificate...');
    const pems = selfsigned.generate(
        [{ name: 'commonName', value: 'cetp-server' }],
        { days: 365, keySize: 2048 }
    );
    log('[TLS] ✅ Certificate generated successfully');

    const server = https.createServer({ key: pems.private, cert: pems.cert }, (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id');

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        let body = [];
        req.on('data', (chunk) => body.push(chunk));

        req.on('end', async () => {
            const rawBody = Buffer.concat(body);

            try {
                // POST /handshake
                if (req.url === '/handshake' && req.method === 'POST') {
                    const payload = JSON.parse(rawBody.toString());
                    const clientPin = payload.pin;
                    const clientPublicKeyHex = payload.publicKey;

                    if (pin && clientPin !== pin) {
                        log(`[HANDSHAKE] ❌ PIN mismatch from ${req.socket.remoteAddress}`);
                        res.writeHead(403, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Invalid PIN' }));
                        return;
                    }

                    const clientPublicKeyBytes = Buffer.from(clientPublicKeyHex, 'hex');
                    const serverKeyPair = generateKeyPair();
                    const serverPublicKeyBytes = getPublicBytes(serverKeyPair);
                    const sessionKey = deriveSessionKey(serverKeyPair.privateKey, clientPublicKeyBytes);

                    // Compute key fingerprint for MitM detection
                    const fingerprint = computeFingerprint(sessionKey);

                    const sessionId = crypto.randomBytes(16).toString('hex');
                    sessions.set(sessionId, { sessionKey, createdAt: Date.now() });

                    log(`[HANDSHAKE] ✅ Session established: ${sessionId.substring(0, 8)}... from ${req.socket.remoteAddress}`);
                    log(`[HANDSHAKE] 🔑 PIN validated successfully`);
                    log(`[HANDSHAKE] 🔐 Verification Code: ${fingerprint}`);
                    log(`[HANDSHAKE]    Confirm this matches the sender's code.`);

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        publicKey: serverPublicKeyBytes.toString('hex'),
                        sessionId: sessionId,
                        fingerprint: fingerprint
                    }));
                    return;
                }

                // POST /transfer
                if (req.url === '/transfer' && req.method === 'POST') {
                    const sessionId = req.headers['x-session-id'];

                    if (!sessionId || !sessions.has(sessionId)) {
                        log(`[TRANSFER] ❌ Invalid session from ${req.socket.remoteAddress}`);
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Invalid or expired session' }));
                        return;
                    }

                    const session = sessions.get(sessionId);
                    log(`[TRANSFER] 📥 Receiving encrypted payload (${(rawBody.length / (1024 * 1024)).toFixed(2)} MB)...`);

                    const tempFile = path.join(OUTPUT_FOLDER, `transfer_${Date.now()}.bin`);
                    fs.writeFileSync(tempFile, rawBody);

                    try {
                        const result = await receiveFile(tempFile, OUTPUT_FOLDER, session.sessionKey);
                        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);

                        const allValid = result.verificationResults &&
                            result.verificationResults.every(r => r.verification === "Match");

                        if (allValid) {
                            log(`[TRANSFER] ✅ Transfer SUCCESS — all files verified`);
                            result.verificationResults.forEach(r => {
                                log(`  ✔ ${r.file}: ${r.verification}`);
                            });
                        } else {
                            log(`[TRANSFER] ⚠️ Transfer completed with integrity issues`);
                        }

                        log(`[TRANSFER] 📁 Files saved to: ${OUTPUT_FOLDER}`);
                        sessions.delete(sessionId);

                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            status: allValid ? 'success' : 'integrity_error',
                            verification: result.verificationResults,
                            stats: {
                                originalTotal: result.originalTotal,
                                encryptedTotal: result.encryptedTotal,
                                ratio: result.ratio,
                                totalTime: result.totalTime
                            }
                        }));
                    } catch (err) {
                        log(`[TRANSFER] ❌ Error: ${err.message}`);
                        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    }
                    return;
                }

                // GET /status
                if (req.url === '/status' && req.method === 'GET') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'ready', activeSessions: sessions.size }));
                    return;
                }

                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Not found' }));

            } catch (err) {
                log(`[SERVER] ❌ Error: ${err.message}`);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
    });

    server.listen(port, host, () => {
        log(`\n🔒 CETP Receiver listening on https://${host}:${port}`);
        log(`📁 Save location: ${OUTPUT_FOLDER}`);
        if (pin) log(`🔑 PIN: ${pin}`);
        log(`⏳ Waiting for sender connection...\n`);
    });

    server.on('error', (err) => {
        log(`[SERVER] ❌ Server error: ${err.message}`);
    });

    // Cleanup old sessions every 5 minutes
    setInterval(() => {
        const now = Date.now();
        for (const [id, session] of sessions) {
            if (now - session.createdAt > 30 * 60 * 1000) {
                sessions.delete(id);
            }
        }
    }, 5 * 60 * 1000);

    return server;
}

if (require.main === module) {
    const port = parseInt(process.argv[2]) || 8888;
    const pin = process.argv[3] || null;
    const outputFolder = process.argv[4] || null;
    startServer(port, pin, '0.0.0.0', outputFolder);
}

module.exports = { startServer };
