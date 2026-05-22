# Job Profiles

## Overview

A Job Profile is the central entity of the application. Users can maintain multiple profiles — one per target role or industry — so they always have a relevant starting point for CV generation. Each profile stores personal information, work history, education, and skills independently.

---

## User Stories

### US-PROF-1 — View all profiles

**As a** logged-in user,
**I want to** see a list of all my job profiles on a dashboard,
**so that** I can quickly find and open the one I need.

**Acceptance criteria:**
- Each card shows the profile name, full name, and job title.
- An empty state is shown when no profiles exist, with a prompt to create one.

---

### US-PROF-2 — Create a blank profile

**As a** user,
**I want to** create a new blank job profile with a custom name,
**so that** I can tailor it to a specific role or industry from scratch.

**Acceptance criteria:**
- I provide a profile name (defaults to "My Profile").
- After creation I am taken directly to the profile editing page.

---

### US-PROF-3 — Bootstrap a profile from an existing CV

**As a** user who already has a CV document,
**I want to** upload my existing CV (PDF or plain text) and have the app extract my data automatically,
**so that** I don't have to re-type everything from scratch.

**Acceptance criteria:**
- I can upload a PDF or `.txt` file from the profile creation flow.
- The AI extracts: full name, professional title, work experience entries (company, role, dates, description), education entries, and skills.
- Extracted data pre-populates the new profile; I can review and edit before saving.
- If extraction partially fails, the profile is still created with whatever was extracted and I am notified.

---

### US-PROF-4 — Delete a profile

**As a** user,
**I want to** delete a job profile I no longer need,
**so that** my dashboard stays uncluttered.

**Acceptance criteria:**
- A delete action is available on each profile card.
- I am asked to confirm before deletion.
- Deleting a profile also removes all CVs generated from it.

---

### US-PROF-5 — Navigate between profiles

**As a** user with multiple profiles,
**I want to** switch between profiles easily,
**so that** I can manage different career tracks without confusion.

**Acceptance criteria:**
- A "back to profiles" navigation is available from within the profile editing page.
- Returning to the dashboard shows all profiles with their current state.
