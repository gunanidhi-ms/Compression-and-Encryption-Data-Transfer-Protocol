const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { receiveFile } = require('./receiver/receiver');
const { generateKeyPair, getPublicBytes, deriveSessionKey } = require('./shared/crypto');
const { PeerJSSignaling, generatePeerId } = require('./shared/signaling');
const { WebRTCConnection } = require('./shared/webrtc');

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

async function startServer(pin, outputFolder = null) {
    // If no PIN provided, generate a random 6-digit PIN
    if (!pin) {
        pin = Math.floor(100000 + Math.random() * 900000).toString();
    }

    const OUTPUT_FOLDER = outputFolder || path.join(__dirname, 'received_files');
    if (!fs.existsSync(OUTPUT_FOLDER)) {
        fs.mkdirSync(OUTPUT_FOLDER, { recursive: true });
    }

    const peerId = generatePeerId(pin);
    log(`[TLS] WebRTC Receiver Started.`);
    log(`📁 Save location: ${OUTPUT_FOLDER}`);
    log(`🔑 PIN: ${pin}`);
    log(`⏳ Connecting to signaling server...`);

    const signaling = new PeerJSSignaling(peerId);
    let rtcConnection = null;

    try {
        await signaling.connect();
        log(`[TL] 🌐 Connected to global signaling network. Waiting for sender...`);
    } catch (err) {
        log(`[ERROR] Signaling connection failed: ${err.message}`);
        return;
    }

    let sessionKey = null;
    let tempFile = null;
    let fileStream = null;
    let handshakeComplete = false;
    let expectedSize = 0;
    let receivedSize = 0;

    signaling.handlers.onMessage = (msg) => {
        if (msg.type === 'OFFER' && !rtcConnection) {
            log(`[SIGNALING] Received connection offer from sender. Establishing direct peer-to-peer route...`);
            rtcConnection = new WebRTCConnection(signaling, msg.src, false);

            rtcConnection.handlers.onDataChannelOpen = () => {
                log(`[WEBRTC] ✅ Direct encrypted tunnel established!`);
            };

            rtcConnection.handlers.onMessage = async (channelMsg) => {
                if (!channelMsg.isBinary) {
                    try {
                        const data = JSON.parse(channelMsg.data);

                        // Handshake processing
                        if (data.type === 'handsake' && !handshakeComplete) {
                            if (data.pin !== pin) {
                                log(`[HANDSHAKE] ❌ PIN mismatch detected over tunnel.`);
                                rtcConnection.sendText(JSON.stringify({ type: 'error', error: 'Invalid PIN' }));
                                rtcConnection.close();
                                return;
                            }

                            const clientPublicKeyBytes = Buffer.from(data.publicKey, 'hex');
                            const serverKeyPair = generateKeyPair();
                            const serverPublicKeyBytes = getPublicBytes(serverKeyPair);
                            sessionKey = deriveSessionKey(serverKeyPair.privateKey, clientPublicKeyBytes);

                            const fingerprint = computeFingerprint(sessionKey);
                            log(`[HANDSHAKE] ✅ Secure session established.`);
                            log(`[HANDSHAKE] 🔐 Verification Code: ${fingerprint}`);

                            rtcConnection.sendText(JSON.stringify({
                                type: 'handshake_reply',
                                publicKey: serverPublicKeyBytes.toString('hex'),
                                fingerprint: fingerprint
                            }));

                            handshakeComplete = true;
                        }
                        // Start of file transfer metadata
                        else if (data.type === 'start_transfer') {
                            expectedSize = data.size;
                            receivedSize = 0;
                            tempFile = path.join(OUTPUT_FOLDER, `transfer_${Date.now()}.bin`);
                            fileStream = fs.createWriteStream(tempFile);
                            log(`[TRANSFER] 📥 Receiving encrypted payload (${(expectedSize / (1024 * 1024)).toFixed(2)} MB)...`);
                        }
                    } catch (e) {
                        log(`[ERROR] Parsing or handling message: ${e.message}`);
                        console.error(e);
                    }
                } else {
                    // Binary chunk received
                    if (fileStream) {
                        fileStream.write(channelMsg.data);
                        receivedSize += channelMsg.data.length;

                        if (receivedSize >= expectedSize) {
                            fileStream.end(async () => {
                                log(`[TRANSFER] 📥 Download complete. Verifying and decrypting...`);
                                try {
                                    const result = await receiveFile(tempFile, OUTPUT_FOLDER, sessionKey);
                                    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);

                                    const allValid = result.verificationResults && result.verificationResults.every(r => r.verification === "Match");

                                    if (allValid) {
                                        log(`[TRANSFER] ✅ Transfer SUCCESS — all files verified`);
                                        result.verificationResults.forEach(r => log(`  ✔ ${r.file}: ${r.verification}`));
                                    } else {
                                        log(`[TRANSFER] ⚠️ Transfer completed with integrity issues`);
                                    }

                                    log(`[TRANSFER] 📁 Files saved to: ${OUTPUT_FOLDER}`);

                                    rtcConnection.sendText(JSON.stringify({
                                        type: 'transfer_complete',
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
                                    rtcConnection.sendText(JSON.stringify({ type: 'error', error: err.message }));
                                }
                            });
                        }
                    }
                }
            };

            rtcConnection.handlers.onClose = () => {
                log(`[WEBRTC] Connection closed.`);
                rtcConnection = null;
                handshakeComplete = false;
            };

            rtcConnection.handlers.onError = (err) => {
                log(`[WEBRTC] Error: ${err.message}`);
            };

            rtcConnection.handleSignalingMessage(msg);

        } else if (rtcConnection) {
            // Forward answering and ICE candidates to the existing connection
            rtcConnection.handleSignalingMessage(msg);
        }
    };
}

if (require.main === module) {
    const args = process.argv;
    let pin = null;
    let outFolder = null;

    const pIndex = args.indexOf('--pin');
    if (pIndex > -1) {
        pin = args[pIndex + 1];
        // Capture any positional argument that is not the PIN or the flag
        const remainingArgs = args.slice(2).filter(a => a !== '--pin' && a !== pin && a !== 'server');
        if (remainingArgs.length > 0) outFolder = remainingArgs[0];
    } else {
        if (args[2] && args[2] !== 'server' && !args[2].startsWith('--')) pin = args[2];
        if (args[3] && args[3] !== 'server') outFolder = args[3];
    }

    if (outFolder) outFolder = outFolder.replace(/^["']|["']$/g, '');

    startServer(pin, outFolder);
}

module.exports = { startServer };
