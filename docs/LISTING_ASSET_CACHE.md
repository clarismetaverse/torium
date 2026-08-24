# Listing asset cache

## Current behavior

TORIUM keeps the original photo and floor-plan links in the normalized listing and in `triage_listing_assets`. It does not copy every source image during a run.

When a user opens a photo or floor plan in the property detail:

1. `/api/output` supplies a short-lived, HMAC-signed asset token.
2. `/api/listing-asset` validates the token, source host, final redirect, MIME type and 10 MB size limit.
3. The server downloads the asset once and stores it in the private `torium-listing-assets` Supabase Storage bucket.
4. The frontend receives a signed Storage URL valid for 10 minutes and exposes a download action.
5. Later opens reuse the cached object and refresh only the signed URL.

Only HTTPS media from Idealista-owned domains and Immobiliare's `im-cdn.it` domains is accepted. SVG and non-image content are rejected.

## Database and access model

`public.triage_listing_assets` stores source provenance, cache status, object path, content hash, byte size and access timestamps. RLS is enabled. `anon` and `authenticated` have no table privileges; only the server-side service role can access metadata or the private bucket.

The `expires_at` field is currently set to 90 days when an object is cached. It is retention metadata, not yet an automatic deletion job. A future cleanup workflow can remove expired objects after confirming that no active operation still needs them.

## Capacity assumptions

The design is deliberately on-demand to keep early Storage and egress usage small. Monitor:

- cached object count and total `size_bytes`;
- uncached and cached Storage egress;
- failed source downloads by `source_host`;
- objects beyond `expires_at`.

Upgrade the Supabase plan only when measured usage approaches the included limits or when production availability requirements justify it; a paid plan is not required merely to enable this feature.

## Source-content caveat

The cache is private and intended for internal investment screening. It does not transfer ownership of portal media or authorize public redistribution. Original portal links and provenance remain recorded, and portal terms must be respected.
