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

---

### US-PROF-6 — Start a new profile from a default CV template

**As a** user creating a new profile,
**I want to** have it pre-populated with a standard CV structure instead of a blank page,
**so that** I know what sections to fill in and can get started faster.

**Acceptance criteria:**
- When I create a new blank profile, the editor opens with a default set of empty CV sections: **Professional Summary**, **Work Experience**, **Education**, and **Skills**.
- Each section shows its heading plus lightweight placeholder scaffolding (a summary paragraph, one blank experience entry, one blank education entry, an empty skills list) that I can edit or delete.
- The template contains no fake personal data — the header (name, contact) and all content fields start empty; only the structure is provided.
- Creating a profile by bootstrapping from an existing CV (US-PROF-3) is unaffected — extracted data still drives the document, not the template.
- The seeded document is valid per the block-tree schema and renders correctly in both the editor and the PDF.

---

### US-PROF-7 — Rename a profile

**As a** user with existing job profiles,
**I want to** rename a profile after it has been created,
**so that** its name stays meaningful as my goals change (or fix a name I got wrong at creation).

**Acceptance criteria:**
- Each profile row on the Job Profiles dashboard has a visible rename action.
- Activating it lets me edit the name in place; confirming (Enter or clicking away) saves the new name, Escape cancels and restores the old name.
- The profile name shown as the page title in the profile editor header is also editable in place: activating it turns it into an input with the same Enter / click-away / Escape semantics, and the change is saved immediately.
- The new name is persisted: it is still shown after a full page reload, on the dashboard list, and in the profile editor page header.
- Renaming never changes the profile's document content.
- A blank name is rejected: the previous name is kept.

---

### US-PROF-8 — Imported profiles get a meaningful name

**As a** user who creates a profile by uploading an existing CV,
**I want** the new profile to be automatically named from the CV's content when I don't type a name myself,
**so that** my dashboard doesn't fill up with profiles all called "My Profile".

**Acceptance criteria:**
- When I create a profile with the name field left blank and a CV file attached, the AI extraction step also produces a suggested profile name from the CV content, and the created profile is given that name.
- The suggested name is a short role-oriented label (e.g. "Senior Backend Engineer"), extracted by the LLM as part of the same import call — no extra AI round-trip. When the CV states a clear professional title it is used; otherwise a name is inferred from the most recent role; failing that, the person's full name is used.
- The derived name appears on the dashboard list and in the profile editor header — not the "My Profile" placeholder.
- If I do type a name while also attaching a CV, my typed name wins over the derived one.
- If extraction fails or the LLM returns no usable name, the profile falls back to the "My Profile" default (current behaviour).
