# TORIUM authentication and authorization

**Version:** 2.0
**Snapshot:** 2026-09-06
**Production baseline:** `e7e3032` (live), plus the Phase 0 hardening change described below (**not yet deployed**)

Every claim in this document is tagged:

- **[LIVE]** — implemented, tested and verified against production;
- **[TESTED]** — implemented and covered by the automated suite, not yet deployed;
- **[OPERATOR]** — requires a Supabase or Vercel dashboard action that code cannot perform;
- **[FUTURE]** — deliberately deferred.

## 1. Application states

TORIUM recognises exactly five states. Supabase Auth answers *who you are*;
`public.torium_memberships` answers *whether you may enter*.

| State | Product pages | Product API | Run/valuation API | Password lifecycle |
| --- | --- | --- | --- | --- |
| unauthenticated | redirect to `/login` | 401 | 403 then 401 | may request recovery |
| authenticated, no membership | redirect to `/login?reason=membership_inactive` | 403 `membership_inactive` | 403 | **may set its password** |
| active investor | allowed | allowed | 403 `Insufficient permissions` | allowed |
| active admin | allowed | allowed | allowed | allowed |
| suspended member | redirect, session revoked | 403 `membership_inactive` | 403 | allowed |

The fourth column matters: password lifecycle is Supabase *identity*, not TORIUM
*authorization*. An invited account must be able to set its password before an
operator grants access, and a suspended member must still be able to recover a
password. Neither state can read product data. **[TESTED]**

## 2. Security model

Supabase Auth owns identity and the password lifecycle; the Vercel backend owns
the browser session. Access and refresh tokens live only in HttpOnly cookies.
Production cookies are `Secure`, `SameSite=Lax`, `Path=/`, carry no `Domain`
attribute and use the `__Host-` prefix. Legacy unprefixed cookies are actively
expired on every session write. **[LIVE]**

Roles come only from the server-managed membership row. `user_metadata` is
never consulted for authorization. **[LIVE]**

## 3. Invitation and registration

TORIUM is invite-first. There are two paths.

**Operator path (deterministic).** **[LIVE]**

    npm run auth:invite -- investor@example.com investor
    npm run auth:invite -- operator@example.com admin

The command needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. It sends the
Supabase invitation *and* creates the matching active membership. The
service-role key must never reach the browser or a prompt.

**Self-service path (`/register`).** **[TESTED]**

`POST /api/auth-password` with `{ action: "invite", email }` sends the Supabase
invitation through the GoTrue admin endpoint and **creates no membership**. The
invited account lands in the "authenticated without active membership" state:
it can set a password and nothing else until an operator activates it.

> Root cause of the previous behaviour: the invite was sent through the shared
> `authRequest()` helper, which carries only the publishable key. GoTrue's
> `/auth/v1/invite` requires a service-role bearer and answered `401
> no_authorization` on every call; the error was swallowed and the caller always
> saw the generic success message, so `/register` never sent anything. The same
> function also upserted an **active investor membership**, so simply supplying
> the service key would have let any anonymous visitor grant itself product
> access. Both problems are fixed together: `adminAuthRequest()` sends the
> invitation, and membership activation was removed from the request path.

Responses are generic and identical for valid, unknown and malformed addresses,
so neither route reveals whether an account exists. **[TESTED]**

## 4. Password recovery

`/forgot-password` posts `{ action: "request", email }`. The response is always
the same 200 body — including when Supabase itself answers 429 or 4xx, because
propagating an upstream status would turn the endpoint into an enumeration
oracle. **[TESTED]**

Supabase sends a one-time link to `/set-password`. The page strips tokens from
the URL fragment before any other request, hands the session to the server, and
accepts a password of 12–128 characters. After the update TORIUM requests a
global logout and clears every auth cookie, so all devices must authenticate
again. **[LIVE]**

OneSignal remains appropriate for property alerts and push notifications. It is
never used for password recovery.

## 5. Rate limiting **[TESTED]**

| Bucket | Limit | Window | Subject |
| --- | --- | --- | --- |
| `login` | 10 | 5 min | source address + email |
| `recovery` | 5 | 15 min | source address |
| `invite` | 3 | 60 min | source address |
| `password_update` | 10 | 15 min | source address + user id |
| `session_adopt` | 20 | 15 min | source address + user id |
| `preferences_write` | 60 | 15 min | source address + user id |

Counters live in `public.torium_rate_limits` and are shared by every serverless
instance, because a module-global counter only bounds one warm instance and a
burst spread across instances would be effectively unlimited.

Subjects are HMAC-SHA256 digests keyed by `TORIUM_AUTH_HASH_SALT` (falling back
to the service-role key). **No IP address or email address is stored.**

**Known risk:** when the counter backend is unreachable the limiter falls back
to a per-instance in-memory window and logs the degradation, rather than locking
every member out of login during a database incident. This is a deliberate
availability trade-off.

## 6. Database controls

`public.torium_memberships` — forced RLS; authenticated users read only their own
row; role and status are constrained; writes are server-only. **[LIVE]**

`public.investor_alert_preferences` — forced RLS; every operation requires
`auth.uid()` ownership **and** an active membership. The API calls PostgREST
with the member's own access token, so Postgres RLS is authoritative rather than
decorative. **[LIVE]**

`public.torium_auth_events` — forced RLS; no anon or authenticated privileges;
server-only. The vocabulary now covers `login_failed`, `login_denied_membership`,
`invite_requested` and `recovery_requested`, so the most security-relevant
events are no longer invisible. Rows carry an event type, an optional user id
and a pseudonymous subject digest — never a password, token, email address or
raw IP address. **[TESTED]**

`public.torium_rate_limits` — forced RLS; no anon or authenticated privileges;
the counter function is `security definer` with a pinned empty `search_path` and
is executable by `service_role` only. **[TESTED]**

The `triage_*`, `virtual_renewal*`, `renewal_styles` and
`milan_idealista_locations` tables have RLS enabled with **no policies**: they
are closed to anon and authenticated and reachable only through the service
role. This is correct by closure, but it means the API guard is their only
defence — there is no second line at the database for notes and renewals.
**[LIVE]**

## 7. HTTP controls

- mutation endpoints reject cross-origin requests and now **fail closed** when a
  request supplies neither `Origin`, nor `Referer`, nor an explicit same-origin
  `Sec-Fetch-Site`; browsers always attach `Origin` to a fetch-driven mutation,
  so only a non-browser client is affected **[TESTED]**;
- a single `isSameOrigin` implementation is shared by every handler; the earlier
  divergent copy in `api/property-note.js` was removed **[TESTED]**;
- every authenticated response is `Cache-Control: no-store, private` with
  `Vary: Cookie`. `/api/output`, `/api/villa-runs` and `/api/renewals` GET
  previously declared `public, s-maxage=…` *after* the authentication guard, so
  an authenticated body — including the 1-hour signed renewal asset URLs — was
  eligible for a shared CDN cache with no cookie keying **[TESTED]**;
- 500 responses no longer echo upstream PostgREST text **[TESTED]**;
- HSTS, nosniff, DENY framing, strict referrer policy and a restrictive
  permissions policy are configured **[LIVE]**;
- login, register and recovery pages carry a restrictive CSP **[LIVE]**;
- expensive run endpoints require an active **admin** membership **[LIVE]**;
- logout is global rather than browser-local, and is now reachable from every
  protected page rather than only `/account` **[TESTED]**.

## 8. Return-path (`next`) handling **[TESTED]**

`public/safe-next.js` is the single allowlist for the post-login destination.
A value is accepted only when it is a plain internal path.

> Root cause of the previous behaviour: `login.js` accepted any value starting
> with `/` that did not start with `//`. Browsers normalise `\` to `/` inside a
> URL, so `?next=/\evil.example` passed the check and then resolved to the
> protocol-relative `//evil.example` — an open redirect executed immediately
> after a successful login.

Rejected: `//host`, `/\host`, `\\host`, any absolute URL, any scheme, any
control character (including tab and newline), `/@host`, `/:`, and anything over
512 characters. Rejected values fall back to `/home`.

## 9. MFA readiness **[TESTED]** / **[FUTURE]**

`requireRole()` reads the session's `aal` claim and, when
`TORIUM_REQUIRE_ADMIN_MFA=true`, refuses an admin request that is not `aal2`.
The flag defaults to **false** and must stay false until every admin has
enrolled a TOTP factor — enabling it first would lock the only operator out.
Enrolment UI is deliberately not built yet. Current state: 0 factors enrolled.

## 10. Operator actions still required **[OPERATOR]**

None of the following can be performed from code. All values below are settings,
not secrets; no credential belongs in this repository.

1. **Custom SMTP.** Supabase's built-in mail is heavily rate-limited and, on
   recent projects, restricted to team-member addresses — the most likely cause
   of invite or recovery mail not arriving. Verify the TORIUM sending domain in
   Resend, then set Supabase → Authentication → SMTP Settings to the Resend host,
   port 587, the Resend SMTP username, and an API key stored only in Supabase.
2. **Site URL.** Supabase → Authentication → URL Configuration → Site URL:
   `https://torium-nu.vercel.app`
3. **Redirect allowlist.** Exactly these entries, and no wildcard host:
   - `https://torium-nu.vercel.app/set-password`
   - `https://torium-nu.vercel.app/login`
4. **Leaked-password protection.** Supabase → Authentication → Policies → enable
   "Prevent use of leaked passwords" (HaveIBeenPwned). The security advisor
   currently reports this as disabled.
5. **Password policy.** Minimum length 12 to match the API, plus the required
   character classes the plan offers.
6. **Session limits.** Define inactivity timeout and maximum session lifetime in
   Supabase → Authentication → Sessions. The refresh cookie currently allows 30
   days.
7. **Email templates.** Customise invite, recovery and password-changed
   templates, and enable password-changed security notifications.
8. **Vercel environment.** Optionally set `TORIUM_AUTH_HASH_SALT` to a dedicated
   random value so audit and rate-limit pseudonyms can be rotated independently
   of the service-role key. Leave `TORIUM_REQUIRE_ADMIN_MFA` unset or `false`.

## 11. Verification status

Covered by the automated suite (`npm test`, 176 tests):

unauthenticated redirect with return path · safe internal `next` return ·
rejection of external and malformed `next` · active investor access · active
admin access · missing-membership denial · suspended-membership denial ·
investor denial on run endpoints · generic recovery response including upstream
failure · expired/invalid session · logout with global revocation · renewal
publisher separation · authenticated responses not publicly cacheable ·
service-role invite that grants no membership · login rate limiting ·
fail-closed origin checks.

Not yet proven: real email delivery, MFA enrolment, and browser end-to-end
behaviour against a deployed preview. These need the operator actions in §10 and
a deployment.
