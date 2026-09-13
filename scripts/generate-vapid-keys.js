#!/usr/bin/env node
// Generates the VAPID key pair that identifies TORIUM to every push service.
//
//   node scripts/generate-vapid-keys.js
//
// The public key is handed to browsers when they subscribe and is not secret.
// The private key signs every push request: whoever holds it can make any
// TORIUM subscriber's device show a notification, so it belongs in the Vercel
// environment and nowhere else - not in the repository, not in a commit, not in
// a chat message.
//
// Rotating the pair invalidates every existing subscription: browsers bind a
// subscription to the public key it was created with, and every device has to
// subscribe again. Generate once, then leave it alone.
import { generateVapidKeys } from '../lib/web-push.js';

const keys = generateVapidKeys();

process.stdout.write([
  'TORIUM_VAPID_PUBLIC_KEY=' + keys.publicKey,
  'TORIUM_VAPID_PRIVATE_KEY=' + keys.privateKey,
  '',
  '# Add all three to the Vercel project environment (Production and Preview):',
  '#   TORIUM_VAPID_PUBLIC_KEY   - sent to browsers, not secret',
  '#   TORIUM_VAPID_PRIVATE_KEY  - secret, mark it as sensitive',
  '#   TORIUM_VAPID_SUBJECT      - a mailto: or https: URL a push service can',
  '#                               use to reach whoever operates this sender,',
  '#                               e.g. mailto:ops@taurum.cloud',
  '',
].join('\n'));
