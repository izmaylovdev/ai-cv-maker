# ADR-0017: Bind Google sign-in to our OAuth client and verified email

- **Status:** Accepted
- **Date:** 2026-07-02

## Context

cv-api accepts Google sign-in through four flows in `AuthService`: an ID-token
credential (`/api/auth/google`), an authorization code (`/api/auth/google/code`),
and a raw access token (`/api/auth/google/token`, used by the Chrome extension
via `chrome.identity.getAuthToken`).

Two trust gaps existed:

1. **Access-token flow trusted any Google token.** It called the `userinfo`
   endpoint, which returns the token's *subject and email* but not its
   *audience* — the OAuth client the token was minted for. A Google access token
   is a bearer token issued *to an app*, not proof of intent to sign in to us.
   Any third-party site or app the victim had ever granted the
   `userinfo.email` scope to could replay its own access token to this endpoint
   and receive a full Applysy session as that user (token substitution).

2. **All flows linked accounts by email without checking `email_verified`.**
   Each flow falls back to matching an existing user by email address and
   permanently attaches the caller's `GoogleId` to it. Without requiring a
   Google-verified email, an identity carrying an unverified email string that
   collides with a password-account's email could be linked onto that account.

## Decision

- The access-token flow validates the token via Google's `tokeninfo` endpoint
  (which returns `aud`) and rejects the token unless its `aud` is in an
  allowlist of the OAuth clients we own (`Google:WebClientId`,
  `Google:ExtensionClientId`).
- All Google flows require a Google-verified email (`email_verified == true`)
  and a present subject + email before an account is matched or created by
  email. The ID-token flows already pin `aud` to our web client via
  `GoogleJsonWebSignature.ValidateAsync`.
- The audience-allowlist + verified-email decision is a pure, unit-tested
  function (`AuthService.IsTrustedGoogleToken`) so the security-critical branch
  is covered without live HTTP.
- `Google:ExtensionClientId` in `appsettings.json` was stale (a different GCP
  project) and is corrected to the extension's actual OAuth client id from the
  extension `manifest.json`, so that legitimate extension tokens pass the
  allowlist.

## Alternatives considered

- **Keep `userinfo` and skip audience checks.** Rejected: it is exactly the
  token-substitution hole — `userinfo` never reveals the audience, so the server
  cannot tell its own tokens from a third party's.
- **Drop the access-token flow and make the extension use the ID-token flow**
  like the web app. A cleaner long-term shape, but a larger extension change;
  the audience check closes the vulnerability without a client rewrite. Left as
  a possible follow-up.
- **Trust `email_verified` only, not audience.** Insufficient: a verified-email
  token minted for another app is still replayable.

## Consequences

- The set of OAuth clients that can sign a user in is now explicit configuration
  (`Google:WebClientId`, `Google:ExtensionClientId`). Adding a new first-party
  client (e.g. a mobile app) requires adding its client id to the allowlist, or
  its tokens are rejected — fail-closed by design.
- `Google:ExtensionClientId` must match the id the extension actually requests
  tokens for. If the extension's OAuth client changes, this config must change
  with it, or extension login breaks. Verify the deployed value against the
  real GCP project.
- Unverified-email Google identities can no longer create or link accounts;
  this is intended.
- Revisit if we move the extension to the ID-token flow, at which point the
  access-token endpoint (and `tokeninfo` call) can be removed.
