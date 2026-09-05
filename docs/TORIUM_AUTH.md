# TORIUM authentication and authorization

Status: production-hardening implementation, 2026-09-02.

## Security model

TORIUM uses Supabase Auth for identity and password lifecycle, while the Vercel
backend owns the browser session. Access and refresh tokens are kept only in
HttpOnly cookies. Production cookies are Secure, SameSite=Lax, Path=/ and use
the __Host- prefix.

Authentication alone is not enough to enter TORIUM. Every user must also have
an active row in public.torium_memberships:

- investor: may read the product and save only their own alert preferences;
- admin: has investor access and may invoke scraping, valuation and villa runs;
- suspended or missing membership: denied and signed out.

The membership table is server managed. Application authorization never trusts
user-editable user_metadata.

## Invite + registration request

TORIUM remains invite-first, with one public onboarding route for investor requests:

- `GET /register` renders a request form;
- `POST /api/auth-password` with `{ action: "invite", email }` sends the invite.

The server validates origin, keeps responses generic and sends the Supabase
link to `.../set-password` using the current request host (fallback:
`https://torium-nu.vercel.app`). This supports operation without a custom domain
while waiting for a branded domain.

For deterministic operator onboarding, the server-only command is still available:

    npm run auth:invite -- investor@example.com investor
    npm run auth:invite -- operator@example.com admin

The command needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. It asks Supabase
Auth to send the invite and creates the corresponding active membership. The
service-role key must never be exposed to the browser or copied into a prompt.

The invitation redirects to:

    https://torium-nu.vercel.app/set-password

This URL must be present in Supabase Authentication > URL Configuration >
Redirect URLs.

## Password recovery

The login page links to /forgot-password. The response is deliberately generic
so callers cannot discover whether an email address has an account.

Supabase sends a one-time recovery link to /set-password. The page removes
tokens from the URL fragment before making other requests, hands the session to
the server, and accepts a password from 12 to 128 characters. After the update,
TORIUM requests global logout and clears every auth cookie so all devices must
authenticate again.

Use Supabase Auth with custom SMTP for this mail. Recommended first setup:

1. verify the TORIUM sending domain in Resend;
2. configure Resend SMTP in Supabase Auth;
3. set the Site URL to https://torium-nu.vercel.app;
4. allow https://torium-nu.vercel.app/set-password as a redirect URL;
5. customize invite, recovery, and password-changed templates;
6. enable password-changed security notifications.

OneSignal remains appropriate for property alerts and push notifications, not
for password recovery.

## Database controls

public.torium_memberships:

- forced RLS;
- authenticated users can read only their own row;
- role and status are constrained;
- writes are server-only.

public.investor_alert_preferences:

- forced RLS;
- each operation requires auth.uid() ownership;
- each operation also requires an active membership;
- the Vercel API uses the user's access token, so Postgres RLS is authoritative.

public.torium_auth_events:

- forced RLS;
- no anon or authenticated privileges;
- server-only minimal audit events;
- no password, token, raw IP address, or email payload is stored.

The two shortlist views use security_invoker=true, so they cannot inherit the
view owner's ability to bypass RLS.

## HTTP controls

- mutation endpoints reject cross-origin requests;
- all account responses and APIs are no-store;
- HSTS, nosniff, DENY framing, strict referrer policy and a restrictive
  permissions policy are configured;
- login and recovery pages have a restrictive Content Security Policy;
- expensive run endpoints require an authenticated admin membership;
- logout is global rather than browser-local.

## Remaining production work

- connect and verify the custom SMTP provider;
- create the first admin invite;
- enable stronger Supabase password rules and leaked-password protection when
  the plan supports it;
- add TOTP MFA for admins first, then optionally require it for investors;
- define session inactivity and maximum-lifetime values in Supabase Auth;
- add operational alerts for repeated Auth failures without storing sensitive
  credentials.
