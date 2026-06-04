# Chrome Extension — User Stories

### US-EXT-1 — Auto-fill cover letters and application form fields on job sites

**As a** job seeker using the AI CV Maker Chrome extension,
**I want to** press a hotkey on any job application page and have the extension detect text fields (cover letter, application questions), generate tailored content from my profile and CV, and paste it into the correct fields,
**so that** I can apply to jobs faster and with higher-quality, personalised content without manually copying and editing text.

**Acceptance criteria:**
- The extension icon is visible in the Chrome toolbar and shows an enabled/disabled badge per site.
- Pressing the configurable hotkey (default `Alt+Shift+F`) on a page triggers field detection and generation.
- The extension detects `<textarea>` and rich-text editor elements likely to be cover letter / open-ended application fields (heuristics: label text, placeholder, `name`/`id` attributes).
- For each detected field, the extension calls the backend API with the job description context (page title + surrounding text) and the user's active profile.
- The API returns generated text; the extension inserts it into the field and fires the appropriate DOM events so the host page's framework registers the change.
- If no suitable field is found, the extension shows a popup notification: "No application fields detected on this page."
- The user can review and manually edit the generated text before submitting the form.
- The extension works on at least: LinkedIn, Greenhouse, Lever, Workday, and generic HTML forms.
- Authentication with the AI CV Maker backend uses the same JWT token stored via `@ai-cv-maker/auth` (token is passed from a companion settings page or login flow within the extension).

### US-EXT-2 — Sign in to the extension with Google

**As a** job seeker who uses Google to sign in to AI CV Maker,
**I want to** click "Sign in with Google" in the extension popup,
**so that** I can authenticate without typing a password and use the same account I already have on the web app.

**Acceptance criteria:**
- A "Sign in with Google" button appears on the extension login screen alongside the existing email/password form.
- Clicking the button opens Google's OAuth consent screen via `chrome.identity.launchWebAuthFlow`.
- On success, the extension receives a Google ID token and exchanges it with the backend (`POST /api/auth/google`), storing the resulting JWT just like email/password login does.
- On failure (user cancels, network error, invalid token), a clear error message is shown in the popup.
- Existing email/password login continues to work unchanged.
