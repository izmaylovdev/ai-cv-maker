# Users Management

## Overview

Administrators need visibility into all registered users to monitor growth, troubleshoot accounts, and understand usage patterns.

---

## User Stories

### US-ADMIN-1 — View all registered users

**As an** administrator,
**I want to** see a list of all registered users,
**so that** I can monitor account growth and verify registrations.

**Acceptance criteria:**
- The admin panel displays a table with all users ordered by registration date (newest first).
- Each row shows: email, authentication method (Email / Google), number of profiles, and registration date.
- The total user count is shown above the table.

---

### US-ADMIN-2 — Distinguish authentication methods

**As an** administrator,
**I want to** see how each user signed up (email/password or Google),
**so that** I can understand which auth methods are most popular.

**Acceptance criteria:**
- Users who signed up with Google are labelled "Google".
- Users who signed up with email/password are labelled "Email".

---

### US-ADMIN-3 — See user profile activity

**As an** administrator,
**I want to** see how many CV profiles each user has created,
**so that** I can gauge engagement.

**Acceptance criteria:**
- The profile count for each user is displayed in the table.
- A count of 0 is shown for users who have not created any profiles.

---

### US-ADMIN-4 — Admin authentication via Google or email/password

**As an** administrator,
**I want to** sign in to the admin panel using either my Google account or an email/password,
**so that** access is secure and only authorized admins can reach admin functionality.

**Acceptance criteria:**
- The admin panel has a login page with both a "Sign in with Google" button and an email/password form.
- Only accounts pre-registered as admins can log in; all others are rejected with a clear error message.
- A successful login (either method) issues a JWT that is stored client-side and sent as a Bearer token on subsequent requests.
- Logged-in admins can sign out; the JWT is discarded client-side.
- Admin identity (email, allowed admins and their credentials) is stored in a **dedicated admin database**, separate from the main `cv-api` PostgreSQL instance.
- Unauthenticated requests to any admin API route return `401`; the frontend redirects to the login page.
