import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { encryptPushPayload, vapidAuthorization, generateVapidKeys, assertVapidKeyPair, fromBase64url }
  from '../lib/web-push.js';

// RFC 8291 section 5. Every value below is the specification's own worked
// example: if our encryption drifts, this stops matching byte for byte, which
// is the only way to be sure a browser will still be able to read what we send.
const RFC_8291 = {
  plaintext: 'When I grow up, I want to be a watermelon',
  subscription: {
    endpoint: 'https://push.example.net/push/JzLQ3raZJfFBR0aqvOMsLrt54w4rJUsV',
    keys: {
      p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
      auth: 'BTBZMqHH6r4Tts7J_aSIgg',
    },
  },
  senderKeys: {
    publicKey: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    privateKey: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  },
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6Tlz'
    + 'AC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

test('payload encryption reproduces the RFC 8291 example byte for byte', () => {
  const encrypted = encryptPushPayload({
    payload: RFC_8291.plaintext,
    subscription: RFC_8291.subscription,
    salt: RFC_8291.salt,
    senderKeys: RFC_8291.senderKeys,
  });
  assert.equal(encrypted.toString('base64url'), RFC_8291.body);
});

test('each message is encrypted under a fresh key and salt', () => {
  const first = encryptPushPayload({ payload: 'same text', subscription: RFC_8291.subscription });
  const second = encryptPushPayload({ payload: 'same text', subscription: RFC_8291.subscription });
  assert.notEqual(first.toString('base64url'), second.toString('base64url'));
  assert.equal(first.length, second.length);
});

test('a subscription without usable keys is refused rather than sent in clear', () => {
  assert.throws(() => encryptPushPayload({
    payload: 'text',
    subscription: { keys: { p256dh: 'short', auth: 'BTBZMqHH6r4Tts7J_aSIgg' } },
  }), /p256dh/);
  assert.throws(() => encryptPushPayload({
    payload: 'text',
    subscription: { keys: { p256dh: RFC_8291.subscription.keys.p256dh, auth: 'too-short' } },
  }), /auth secret/);
});

test('the VAPID header is a verifiable ES256 assertion for that push service', () => {
  const keys = generateVapidKeys();
  const header = vapidAuthorization({
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
    subject: 'mailto:ops@example.org',
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    now: Date.UTC(2026, 8, 13, 12, 0, 0),
  });

  const [, token] = header.match(/^vapid t=([^,]+), k=(.+)$/) || [];
  assert.ok(token, 'header is in the RFC 8292 form');
  assert.equal(header.endsWith(keys.publicKey), true);

  const [encodedHeader, encodedClaims, encodedSignature] = token.split('.');
  const claims = JSON.parse(fromBase64url(encodedClaims).toString('utf8'));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, 'mailto:ops@example.org');
  assert.equal(claims.exp, Math.floor(Date.UTC(2026, 8, 13, 12, 0, 0) / 1000) + 12 * 60 * 60);

  const raw = fromBase64url(keys.publicKey);
  const publicKey = createPublicKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: raw.subarray(1, 33).toString('base64url'),
      y: raw.subarray(33, 65).toString('base64url'),
    },
    format: 'jwk',
  });
  assert.equal(verify('sha256', Buffer.from(`${encodedHeader}.${encodedClaims}`, 'utf8'),
    { key: publicKey, dsaEncoding: 'ieee-p1363' }, fromBase64url(encodedSignature)), true);
});

test('the audience follows the push service, so one header cannot be replayed at another', () => {
  const keys = generateVapidKeys();
  const claimsFor = (endpoint) => JSON.parse(fromBase64url(
    vapidAuthorization({ endpoint, subject: 'mailto:ops@example.org', ...keys })
      .split(' ')[1].replace(/,$/, '').replace('t=', '').split('.')[1]).toString('utf8'));
  assert.equal(claimsFor('https://web.push.apple.com/x').aud, 'https://web.push.apple.com');
  assert.equal(claimsFor('https://updates.push.services.mozilla.com/y').aud,
    'https://updates.push.services.mozilla.com');
});

test('a mismatched VAPID key pair is rejected at startup, not at send time', () => {
  const first = generateVapidKeys();
  const second = generateVapidKeys();
  assert.doesNotThrow(() => assertVapidKeyPair(first));
  assert.throws(() => assertVapidKeyPair({ publicKey: first.publicKey, privateKey: second.privateKey }),
    /does not match/);
});
