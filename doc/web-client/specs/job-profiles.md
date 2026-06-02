# Spec: Job Profiles

**Source user stories:** US-PROF-1 – US-PROF-5  
**Feature area:** Creating and managing multiple job profiles  
**Status:** Draft

---

## 1. Overview

A **Job Profile** is the central data entity of the application. Users may create multiple profiles — one per target role or industry — each storing personal info, work experience, education, and skills independently. Profiles serve as the source of truth for CV generation.

---

## 2. Functional Requirements

### 2.1 View All Profiles (US-PROF-1)

| # | Requirement |
|---|-------------|
| F-PROF-1.1 | The profiles dashboard (`/profiles`) lists all profiles belonging to the authenticated user. |
| F-PROF-1.2 | Each profile card displays: profile name, full name, and professional title. |
| F-PROF-1.3 | When no profiles exist, an empty state is shown with a CTA to create the first profile. |

### 2.2 Create a Blank Profile (US-PROF-2)

| # | Requirement |
|---|-------------|
| F-PROF-2.1 | The user can create a new blank profile by providing a profile name (free text). |
| F-PROF-2.2 | If no name is entered, it defaults to `"My Profile"`. |
| F-PROF-2.3 | After creation, the user is immediately redirected to the profile editor at `/profiles/:id`. |

### 2.3 Bootstrap from Existing CV (US-PROF-3)

| # | Requirement |
|---|-------------|
| F-PROF-3.1 | The profile creation flow offers a "Upload existing CV" option accepting `.pdf` and `.txt` files. |
| F-PROF-3.2 | The AI extracts: full name, professional title, work experience entries (company, role, dates, description), education entries, and skills. |
| F-PROF-3.3 | Extracted data pre-populates the new profile; the user reviews and edits before saving. |
| F-PROF-3.4 | Partial extraction (e.g., skills not found) still creates the profile; the user is notified which fields could not be extracted. |
| F-PROF-3.5 | Maximum file size: **5 MB**. Files exceeding this are rejected with a clear error. |

### 2.4 Delete a Profile (US-PROF-4)

| # | Requirement |
|---|-------------|
| F-PROF-4.1 | A delete action is available on each profile card (e.g., a kebab menu or trash icon). |
| F-PROF-4.2 | The user must confirm deletion via a modal dialog before it proceeds. |
| F-PROF-4.3 | Deleting a profile cascades to delete all generated CVs associated with it. |
| F-PROF-4.4 | After deletion the dashboard refreshes and the deleted card is removed. |

### 2.5 Navigate Between Profiles (US-PROF-5)

| # | Requirement |
|---|-------------|
| F-PROF-5.1 | A "← Back to profiles" link is visible in the profile editor header. |
| F-PROF-5.2 | Clicking it returns the user to `/profiles` with all cards in their current state. |

---

## 3. Technical Specification

### 3.1 API Endpoints

#### `GET /api/profiles`

Returns all profiles for the authenticated user.

**Response 200:**
```json
[
  {
    "id": "uuid",
    "name": "Senior Frontend Role",
    "fullName": "Jane Doe",
    "title": "Senior React Developer",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-02T00:00:00Z"
  }
]
```

---

#### `POST /api/profiles`

Creates a new blank profile.

**Request body:**
```json
{ "name": "My Profile" }
```

**Response 201:**
```json
{ "id": "uuid", "name": "My Profile", ... }
```

---

#### `POST /api/profiles/bootstrap`

Creates a profile by extracting data from an uploaded CV file.

**Request:** `multipart/form-data`

| Field | Type | Notes |
|-------|------|-------|
| `file` | file | `.pdf` or `.txt`, max 5 MB |
| `name` | string | Optional profile name |

**Response 201:**
```json
{
  "id": "uuid",
  "name": "...",
  "extractionWarnings": ["Skills could not be extracted"],
  "profile": { ... }
}
```

**Response 422:** File too large or unsupported format.

---

#### `DELETE /api/profiles/:id`

Deletes the profile and all its generated CVs.

**Response 204:** No content.  
**Response 404:** Profile not found or not owned by user.

---

### 3.2 CV Upload & Extraction Pipeline

```
Client → POST /api/profiles/bootstrap (multipart)
       → Server validates file type & size
       → Extract text:
           PDF  → pdf-parse (or pdfjs-dist)
           TXT  → read as UTF-8
       → Send extracted text to AI with structured extraction prompt
       → Parse AI response into ProfileData shape
       → Persist profile (with warnings if partial)
       → Return 201 with profile + warnings
```

AI extraction prompt must instruct the model to output structured JSON matching `ProfileData` (see §3.4). The server validates the JSON before persisting.

### 3.3 Cascade Delete

`DELETE /api/profiles/:id` must:
1. Verify ownership (`userId` match).
2. Delete all `GeneratedCV` records with `profileId = id`.
3. Delete the `Profile` record.

All three steps should run in a single database transaction.

### 3.4 Data Model

```ts
interface Profile {
  id: string;                    // UUID v4
  userId: string;                // FK → User.id
  name: string;                  // display name, max 100 chars
  fullName: string;
  title: string;
  summary?: string;
  location?: string;
  email?: string;
  phone?: string;
  workExperience: WorkEntry[];
  education: EducationEntry[];
  skills: string[];              // ordered array
  sectionOrder: SectionKey[];    // e.g. ["experience","education","skills"]
  createdAt: Date;
  updatedAt: Date;
}

interface WorkEntry {
  id: string;
  company: string;
  role: string;
  startDate: string;             // ISO 8601 date (YYYY-MM)
  endDate?: string;              // null = current role
  description: string;
}

interface EducationEntry {
  id: string;
  institution: string;
  degree: string;
  field: string;
  startYear: number;
  endYear?: number;              // null = ongoing
}

type SectionKey = "experience" | "education" | "skills";
```

### 3.5 Validation Rules

| Field | Rule |
|-------|------|
| `name` | Required, 1–100 characters |
| File type | `.pdf` or `.txt` only |
| File size | ≤ 5 MB |
| `fullName` | Required when saving a profile (not on initial creation) |
| `title` | Required when saving a profile |

---

## 4. Error States & UX

| Scenario | UI Behaviour |
|----------|-------------|
| File too large | Inline error: _"File must be under 5 MB."_ |
| Unsupported file type | Inline error: _"Only PDF or plain text files are supported."_ |
| Extraction partially failed | Info banner in editor: _"Some fields couldn't be extracted — please review."_ |
| Delete network error | Toast: _"Could not delete profile. Please try again."_ |

---

## 5. Out of Scope (MVP)

- Profile duplication / cloning
- Sharing or exporting a profile (other than as PDF CV)
- Profile templates
- Folder / tag organisation
