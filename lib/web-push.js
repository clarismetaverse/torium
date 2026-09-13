// Web Push, implemented against the standards rather than a vendor SDK.
//
// A push subscription is a URL the browser hands us plus two keys, and the
// browser vendors agreed on how to talk to it: RFC 8291 for the payload
// encryption, RFC 8188 for the aes128gcm content encoding, RFC 8292 for
// proving who is sending. Firebase Cloud Messaging is one implementation of
// the receiving side, not a requirement of the sending side: Chrome
// subscriptions happen to live on fcm.googleapis.com, Firefox on
// updates.push.services.mozilla.com, Safari on web.push.apple.com, and the
// request we make is identical for all three.
//
// The payload is encrypted end to end. The push service forwards bytes it
// cannot read, so a listing we push is never visible to Google, Mozilla or
// Apple.
import { createECDH, createPrivateKey, createPublicKey, createCipheriv, hkdfSync, randomBytes, sign } from 'node:crypto';

const CURVE = 'prime256v1';

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(value) {
  return Buffer.from(String(value).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

// An uncompressed P-256 point is 0x04 followed by the two 32-byte coordinates.
function pointToJwk(point) {
  const raw = Buffer.from(point);
  if (raw.length !== 65 || raw[0] !== 0x04) throw new Error('Invalid P-256 public key');
  return { x: base64url(raw.subarray(1, 33)), y: base64url(raw.subarray(33, 65)) };
}

export function generateVapidKeys() {
  const ecdh = createECDH(CURVE);
  ecdh.generateKeys();
  return {
    publicKey: base64url(ecdh.getPublicKey()),
    privateKey: base64url(ecdh.getPrivateKey()),
  };
}

// RFC 8291 section 3.4: the input keying material binds the shared ECDH secret
// to both public keys and to the subscription's auth secret, so a payload can
// only be read by the browser that created the subscription.
function deriveContentKeys({ ecdhSecret, authSecret, userAgentPublicKey, senderPublicKey, salt }) {
  const authInfo = Buffer.concat([
    Buffer.from('WebPush: info\0', 'utf8'),
    Buffer.from(userAgentPublicKey),
    Buffer.from(senderPublicKey),
  ]);
  const ikm = Buffer.from(hkdfSync('sha256', ecdhSecret, authSecret, authInfo, 32));
  return {
    contentEncryptionKey: Buffer.from(
      hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16)),
    nonce: Buffer.from(
      hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12)),
  };
}

// One record, which is all a push payload ever needs: the 4096-byte limit the
// push services enforce is smaller than the record size we advertise.
export function encryptPushPayload({ payload, subscription, salt, senderKeys }) {
  const userAgentPublicKey = fromBase64url(subscription?.keys?.p256dh);
  const authSecret = fromBase64url(subscription?.keys?.auth);
  if (userAgentPublicKey.length !== 65) throw new Error('Subscription is missing a valid p256dh key');
  if (authSecret.length !== 16) throw new Error('Subscription is missing a valid auth secret');

  const ecdh = createECDH(CURVE);
  if (senderKeys) ecdh.setPrivateKey(fromBase64url(senderKeys.privateKey));
  else ecdh.generateKeys();
  const senderPublicKey = ecdh.getPublicKey();
  const ecdhSecret = ecdh.computeSecret(userAgentPublicKey);

  const recordSalt = salt ? fromBase64url(salt) : randomBytes(16);
  const { contentEncryptionKey, nonce } = deriveContentKeys({
    ecdhSecret,
    authSecret,
    userAgentPublicKey,
    senderPublicKey,
    salt: recordSalt,
  });

  // RFC 8188 padding: the plaintext is followed by a delimiter, 0x02 marking
  // the last record.
  const plaintext = Buffer.concat([Buffer.from(payload, 'utf8'), Buffer.from([0x02])]);
  const cipher = createCipheriv('aes-128-gcm', contentEncryptionKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(5);
  header.writeUInt32BE(4096, 0);
  header.writeUInt8(senderPublicKey.length, 4);
  return Buffer.concat([recordSalt, header, senderPublicKey, ciphertext]);
}

// RFC 8292: a signed assertion that the sender of this message is the same
// party the subscription was created for. `subject` must be a mailto: or
// https: URL a push service operator could use to contact us.
export function vapidAuthorization({ endpoint, subject, publicKey, privateKey, now = Date.now(), ttlSeconds = 12 * 60 * 60 }) {
  const audience = new URL(endpoint).origin;
  const header = base64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = base64url(JSON.stringify({
    aud: audience,
    exp: Math.floor(now / 1000) + ttlSeconds,
    sub: subject,
  }));

  const point = pointToJwk(fromBase64url(publicKey));
  const key = createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: base64url(fromBase64url(privateKey)), ...point },
    format: 'jwk',
  });
  // JWS wants the raw r||s pair, not the DER sequence OpenSSL produces.
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`, 'utf8'),
    { key, dsaEncoding: 'ieee-p1363' });

  return `vapid t=${header}.${claims}.${base64url(signature)}, k=${publicKey}`;
}

export function assertVapidKeyPair({ publicKey, privateKey }) {
  const derived = createPublicKey({
    key: { kty: 'EC', crv: 'P-256', ...pointToJwk(fromBase64url(publicKey)) },
    format: 'jwk',
  });
  const ecdh = createECDH(CURVE);
  ecdh.setPrivateKey(fromBase64url(privateKey));
  if (base64url(ecdh.getPublicKey()) !== publicKey) {
    throw new Error('VAPID key pair does not match');
  }
  return derived;
}

export { base64url as toBase64url, fromBase64url };
