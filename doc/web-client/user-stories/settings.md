# Settings — User Stories

### US-SETTINGS-1 — Global preferences

**As a** user,
**I want to** configure global preferences for CV generation and AI assistance,
**so that** the AI applies my preferred tone, formatting rules, and writing style consistently across all my CVs and cover letters.

**Acceptance criteria:**
- A Settings page is accessible from the app navigation.
- The page contains a "Global Preferences" section with a textarea (placeholder: "Add tone, formatting, or rules.").
- Changes are saved when the user clicks a Save button.
- Saved preferences are persisted and reloaded when the user revisits the page.
- A success notification confirms the save.

### US-SETTINGS-2 — Apply global preferences to AI generation

**As a** user,
**I want to** have my global preferences automatically applied when the AI generates CVs and cover letters,
**so that** every AI output follows my preferred tone, formatting rules, and writing style without me having to repeat them each time.

**Acceptance criteria:**
- When global preferences are set, they are included in every CV generation request sent to the LLM.
- When global preferences are set, they are included in every cover letter generation request sent to the LLM.
- If no global preferences are saved, generation behaves exactly as before (no regression).

### US-SETTINGS-3 — Manage preferences via AI chat

**As a** user,
**I want to** ask the AI assistant to read or update my global preferences during a conversation,
**so that** I can configure my preferences naturally without navigating to the Settings page.

**Acceptance criteria:**
- The AI assistant can retrieve and display the user's current global preferences when asked.
- The AI assistant can update the user's global preferences when the user describes a change.
- After updating, the new preferences are immediately persisted and reflected on the Settings page.
- The assistant confirms what it changed before or after applying the update.

### US-SETTINGS-4 — Usage page in navigation

**As a** signed-in user,
**I want to** see my AI usage summary on a dedicated page accessible from the navigation,
**so that** I can monitor token consumption and estimated costs without navigating through Settings.

**Acceptance criteria:**
- A "Usage" item appears in the main navigation sidebar for authenticated users
- Clicking it navigates to `/usage`
- The page displays prompt tokens, completion tokens, and estimated cost from `GET /api/usage`
- The page is protected by the auth guard
