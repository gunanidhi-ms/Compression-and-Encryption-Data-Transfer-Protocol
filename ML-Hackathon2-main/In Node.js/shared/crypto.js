const crypto = require("crypto");

function generateKeyPair() {

    return crypto.generateKeyPairSync("x25519");
}

function getPublicBytes(keyPair) {

    return keyPair.publicKey.export({
        type: "spki",
        format: "der"
    }).slice(-32);
}

function deriveSessionKey(
    privateKey,
    peerPublicBytes
) {

    const peerPublicKey =
        crypto.createPublicKey({
            key: Buffer.concat([
                Buffer.from(
                    "302a300506032b656e032100",
                    "hex"
                ),
                peerPublicBytes
            ]),
            format: "der",
            type: "spki"
        });

    const sharedSecret =
        crypto.diffieHellman({
            privateKey,
            publicKey: peerPublicKey
        });

    return Buffer.from(crypto.hkdfSync(
        "sha256",
        sharedSecret,
        Buffer.alloc(0),
        Buffer.from("file-transfer-protocol-v1"),
        32
    ));

}

function encryptChunk(data, key) {

    const iv =
        crypto.randomBytes(12);

    const cipher =
        crypto.createCipheriv(
            "aes-256-gcm",
            key,
            iv
        );

    const encrypted =
        Buffer.concat([
            cipher.update(data),
            cipher.final()
        ]);

    const tag =
        cipher.getAuthTag();

    return { iv, tag, encrypted };
}

function decryptChunk(
    encrypted,
    key,
    iv,
    tag
) {

    const decipher =
        crypto.createDecipheriv(
            "aes-256-gcm",
            key,
            iv
        );

    decipher.setAuthTag(tag);

    return Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
    ]);
}

module.exports = {
    generateKeyPair,
    getPublicBytes,
    deriveSessionKey,
    encryptChunk,
    decryptChunk
};
