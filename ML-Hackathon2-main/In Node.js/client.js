const fs = require('fs');
const path = require('path');
const { sendFile } = require('./sender/sender');
const { generateKeyPair, getPublicBytes, deriveSessionKey } = require('./shared/crypto');
const { PeerJSSignaling, generatePeerId } = require('./shared/signaling');
const { WebRTCConnection } = require('./shared/webrtc');
const crypto = require('crypto');

function log(msg) {
    process.stdout.write(msg + "\n");
}

function computeFingerprint(sharedSecret) {
    return crypto.createHash('sha256')
        .update(sharedSecret)
        .digest('hex')
        .substring(0, 8)
        .toUpperCase()
        .match(/.{4}/g)
        .join('-');
}

async function startClient(inputPath, pin) {
    if (!pin) {
        log("❌ Error: PIN is required to connect via WebRTC.");
        process.exit(1);
    }

    log(`\n🔗 Initializing WebRTC P2P Connection...`);
    log(`🔑 Using PIN: ${pin}`);

    const receiverId = generatePeerId(pin);
    const mySenderId = generatePeerId(pin + '_sender_' + Date.now()); // random suffix so sender has unique ID
    const signaling = new PeerJSSignaling(mySenderId);

    try {
        await signaling.connect();
        log('✅ Connected to secure broker.');
        log(`⏳ Waiting for receiver to connect using PIN [${pin}]... (Do not close this window)`);
    } catch (e) {
        log(`❌ Failed to connect to signaling server: ${e.message}`);
        return;
    }

    // Prepare temp directory
    const tempDir = path.join(require('os').tmpdir(), 'cetp-client');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const clientKeyPair = generateKeyPair();
    const clientPublicKeyBytes = getPublicBytes(clientKeyPair);

    return new Promise((resolve, reject) => {
        const rtcConnection = new WebRTCConnection(signaling, receiverId, true);
        let sessionKey = null;
        let tempFile = null;

        signaling.handlers.onMessage = (msg) => {
            rtcConnection.handleSignalingMessage(msg);
        };

        rtcConnection.handlers.onDataChannelOpen = async () => {
            log('\n[WEBRTC] ✅ Receiver Found! Direct P2P Tunnel Established.');
            log('[HANDSHAKE] Initiating ECDH Key Exchange...');

            // Send handshake
            rtcConnection.sendText(JSON.stringify({
                type: 'handsake', // Notice slight typo fix or maintain from server: 'handsake' in server code
                pin: pin,
                publicKey: clientPublicKeyBytes.toString('hex')
            }));
        };

        rtcConnection.handlers.onMessage = async (msg) => {
            if (!msg.isBinary) {
                const data = JSON.parse(msg.data);

                if (data.type === 'error') {
                    log(`❌ Remote Error: ${data.error}`);
                    reject(new Error(data.error));
                    rtcConnection.close();
                    signaling.close();
                }
                else if (data.type === 'handshake_reply') {
                    const serverPublicKeyBytes = Buffer.from(data.publicKey, 'hex');
                    sessionKey = deriveSessionKey(clientKeyPair.privateKey, serverPublicKeyBytes);
                    const fingerprint = computeFingerprint(sessionKey);

                    log('✅ Handshake successful. Session established.');
                    log(`🔐 Verification Code: ${fingerprint}`);

                    if (data.fingerprint && data.fingerprint !== fingerprint) {
                        log('🚨 WARNING: Verification codes DO NOT match!');
                        log('   This may indicate a man-in-the-middle attack. Aborting.');
                        rtcConnection.close();
                        signaling.close();
                        reject(new Error('MITM Attack suspected'));
                        return;
                    }

                    // Process and send file now that session is verified
                    tempFile = path.join(tempDir, `payload_${Date.now()}.bin`);
                    log(`\n[PROCESS] 📦 Compressing and Encrypting payload locally...`);
                    const stats = await sendFile(inputPath, tempFile, sessionKey, 'zstd');

                    log('\n--- Sender Summary ---');
                    log(`Original Size: ${(stats.originalTotal / (1024 * 1024)).toFixed(2)} MB`);
                    log(`Encrypted Size: ${(stats.encryptedTotal / (1024 * 1024)).toFixed(2)} MB`);
                    log(`Compression Ratio: ${stats.ratio.toFixed(2)}%`);
                    log(`Processing Time: ${stats.totalTime.toFixed(2)}s`);

                    const payload = fs.readFileSync(tempFile);
                    log(`\n[TRANSFER] 📤 Sending encrypted payload directly to peer...`);

                    rtcConnection.sendText(JSON.stringify({
                        type: 'start_transfer',
                        size: payload.length
                    }));

                    // We must send the data in chunks for WebRTC Data Channel buffer limits
                    const CHUNK_SIZE = 64 * 1024; // 64 KB chunks
                    let offset = 0;

                    const sendChunk = () => {
                        while (offset < payload.length) {
                            // Check buffer to avoid backpressure crashes
                            if (rtcConnection.dataChannel.bufferedAmount() > 16 * 1024 * 1024) {
                                setTimeout(sendChunk, 50); // Pause briefly
                                return;
                            }

                            const end = Math.min(offset + CHUNK_SIZE, payload.length);
                            const chunk = payload.subarray(offset, end);
                            rtcConnection.sendBinary(chunk);
                            offset = end;
                        }
                        log(`✅ Payload fully transmitted. Waiting for peer verification...`);
                    };

                    sendChunk();
                }
                else if (data.type === 'transfer_complete') {
                    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);

                    if (data.status === 'success') {
                        log('✅ TRANSFER SUCCESSFUL');
                        log('   All files verified (SHA-256 + AES-256-GCM)');
                        if (data.verification) {
                            data.verification.forEach(v => log(`   ✔ ${v.file}: ${v.verification}`));
                        }
                    } else {
                        log('⚠️ TRANSFER COMPLETED WITH ISSUES');
                    }
                    log('\n✨ P2P Secure Transfer Complete.\n');

                    rtcConnection.close();
                    signaling.close();
                    resolve();
                }
            }
        };

        rtcConnection.handlers.onClose = () => {
            if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
            signaling.close();
            resolve();
        };

        // Trigger the offer stream immediately after setup
        rtcConnection.initiateOffer();
    });
}

if (require.main === module) {
    const input = process.argv[2];
    const args = process.argv.slice(3);
    let pin = null;

    const pinIdx = args.indexOf('--pin');
    if (pinIdx > -1) {
        pin = args[pinIdx + 1];
    } else {
        pin = args[0]; // fallback to first arg after file
    }

    if (input && pin) {
        startClient(input, pin).catch((err) => {
            log(`\n❌ ERROR: ${err.message}\n`);
            process.exit(1);
        });
    } else {
        console.log("Usage: node client.js <file_or_folder> --pin <6-digit-pin>");
    }
}

module.exports = { startClient };
