import 'dotenv/config';

const email = String(process.argv[2] || '').trim().toLowerCase();
const role = String(process.argv[3] || 'investor').trim().toLowerCase();
const redirectTo = String(process.argv[4] || 'https://torium-nu.vercel.app/set-password').trim();
const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  throw new Error('Usage: node scripts/invite-torium-user.js email@example.com [investor|admin] [redirect-url]');
}
if (!['investor', 'admin'].includes(role)) throw new Error('Role must be investor or admin');
if (!url || !serviceKey) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');

const invite = await fetch(url + '/auth/v1/invite?redirect_to=' + encodeURIComponent(redirectTo), {
  method: 'POST',
  headers: {
    apikey: serviceKey,
    Authorization: 'Bearer ' + serviceKey,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    email,
    data: { torium_invite: true },
  }),
});
const invited = await invite.json().catch(() => ({}));
if (!invite.ok || !invited.id) {
  throw new Error(invited.msg || invited.error_description || 'Supabase invite failed');
}

const membership = await fetch(url + '/rest/v1/torium_memberships?on_conflict=user_id', {
  method: 'POST',
  headers: {
    apikey: serviceKey,
    Authorization: 'Bearer ' + serviceKey,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  },
  body: JSON.stringify({
    user_id: invited.id,
    role,
    status: 'active',
    updated_at: new Date().toISOString(),
  }),
});
if (!membership.ok) {
  throw new Error('Invite created, but membership activation failed: ' + await membership.text());
}

console.log('TORIUM invite sent and membership activated:', role);
