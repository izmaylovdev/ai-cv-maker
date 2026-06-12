# Authentication

## Overview

Users must be authenticated to access any part of the application. Two sign-in methods are supported: email/password and Google OAuth.

---

## User Stories

### US-AUTH-1 — Register with email and password

**As a** new user,
**I want to** create an account using my email and a password,
**so that** I can start building my CV profiles.

**Acceptance criteria:**
- I can submit a registration form with email and password.
- After successful registration I am immediately logged in and redirected to my profiles page.
- Duplicate email addresses are rejected with a clear error message.

---

### US-AUTH-2 — Log in with email and password

**As a** returning user,
**I want to** sign in with my email and password,
**so that** I can access my saved profiles and CVs.

**Acceptance criteria:**
- Invalid credentials show an error message without revealing which field is wrong.
- On success I am redirected to my profiles page.

---

### US-AUTH-3 — Sign in with Google

**As a** user who prefers social login,
**I want to** sign in with my Google account via One-Tap,
**so that** I don't have to manage a separate password.

**Acceptance criteria:**
- A "Sign in with Google" option is visible on the login screen.
- Completing the Google flow creates an account (first time) or logs me in (subsequent times).

---

### US-AUTH-4 — Stay logged in across sessions

**As a** user,
**I want** my session to persist after closing the browser tab,
**so that** I don't have to log in every time I return.

**Acceptance criteria:**
- A JWT token is stored securely and reused on return visits until it expires.

---

### US-AUTH-5 — Log out

**As a** logged-in user,
**I want to** log out of the application,
**so that** my account is protected when I leave the device.

**Acceptance criteria:**
- Clicking "Log out" clears the session and redirects me to the login page.
- Navigating to any protected route after logout redirects me to login.

---

### US-AUTH-6 — Make llm-service private in production

**As a** platform operator,
**I want** the LLM gateway and database to be unreachable by anyone except our own services,
**so that** anonymous clients cannot consume paid LLM provider quota, bypass usage accounting, or probe the database.

**Acceptance criteria:**
- Requests to the llm-service URL from the public internet fail; only cv-api can call it.
- All AI features (CV generation, optimize, extract, chat, cover letter) keep working in production.
- The production database does not accept connections from arbitrary internet hosts.
- Local development via docker-compose works unchanged.

Decision and implementation approach: [ADR-0001](../../adr/0001-llm-service-network-privacy.md).
