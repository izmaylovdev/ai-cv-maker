# Chrome Extension — User Stories

### US-EXT-1 — Auto-fill cover letters and application form fields on job sites

**As a** job seeker using the Applysy Chrome extension,
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
- Authentication with the Applysy backend uses the same JWT token stored via `@applysy/auth` (token is passed from a companion settings page or login flow within the extension).

### US-EXT-2 — Sign in to the extension with Google

**As a** job seeker who uses Google to sign in to Applysy,
**I want to** click "Sign in with Google" in the extension popup,
**so that** I can authenticate without typing a password and use the same account I already have on the web app.

**Acceptance criteria:**
- A "Sign in with Google" button appears on the extension login screen alongside the existing email/password form.
- Clicking the button opens Google's OAuth consent screen via `chrome.identity.launchWebAuthFlow`.
- On success, the extension receives a Google ID token and exchanges it with the backend (`POST /api/auth/google`), storing the resulting JWT just like email/password login does.
- On failure (user cancels, network error, invalid token), a clear error message is shown in the popup.
- Existing email/password login continues to work unchanged.

### US-EXT-3 — Download a job-optimised CV from any job posting page

**As a** job seeker using the Applysy Chrome extension,
**I want to** click a button (or press a hotkey) while viewing a job posting and receive a PDF of my CV rewritten to match that job,
**so that** I can submit a tailored, ATS-optimised CV for each application without manually editing my profile each time.

**Acceptance criteria:**
- The extension popup shows a profile selector dropdown listing all the user's profiles, plus an **"Auto"** option at the top (default). When "Auto" is selected the backend picks the best-matching profile; when a specific profile is selected it is used directly.
- The popup shows a "Download Optimised CV" button when the user is authenticated.
- Pressing `Alt+Shift+D` (configurable via Chrome keyboard shortcut settings) triggers the download flow using the currently selected profile option.
- The extension extracts the job title and description from the current page using generic heuristics (page title, headings, body text). If the user has text selected on the page, that selection is used as the job description instead of auto-extraction.
- The popup shows a progress indicator while the CV is being generated.
- When the PDF is ready it downloads automatically, named `[FullName]_[JobTitle]_CV.pdf`.
- If no meaningful job description can be extracted (< 100 characters and no text selected), the button is disabled and a hint is shown: "Could not detect a job description. Select the job text on the page and try again."

### US-EXT-4 — Chat about a job posting in a side panel and accept a cover letter into the page

**As a** job seeker using the Applysy Chrome extension,
**I want to** open a chat side panel from the toolbar icon that already knows about the job posting on the current tab, ask it questions, have it draft a cover letter I can review, and — only when I accept — fill it into the application field on the page,
**so that** I stay in control of what gets written into a form while still getting fast, tailored, context-aware help without leaving the job page.

**Acceptance criteria:**
- Clicking the extension toolbar icon opens a Chrome side panel (the previous popup no longer appears).
- The side panel hosts the Applysy AI chat; on open it has the current page's job posting (title + description) available as context, so the user can immediately ask questions about the role.
- The user can ask the chat to write a cover letter; the draft is shown inside the chat thread for review, not written to the page automatically.
- Each cover-letter draft offers a "Use this" action. Choosing it fills the detected application field on the page; the chat then confirms success (or reports that no field was found).
- If the user does not accept, nothing is written to the page.
- When no application field is detected on the page, accepting reports a clear message in the chat instead of silently failing.
- The user remains authenticated using the same stored credentials/token as before; an expired session prompts re-login from within the panel.
- The side panel can navigate between views; the chat is the default view, and the layout supports adding Settings and Hotkeys views later without re-architecting.
- The existing hotkey-driven flows (quick fill, optimised-CV download) continue to work.

### US-EXT-5 — Generated application text reads as a direct message, not a formal letter

**As a** job seeker filling an application form field on a job site,
**I want to** receive generated text written as a direct, first-person application message rather than a formal letter or email,
**so that** the text looks natural in the website's free-text field and I can submit it without stripping salutations, signatures, and letter formalities by hand.

**Acceptance criteria:**
- Generated application text (both the hotkey auto-fill flow and cover-letter drafts in the side-panel chat) contains no salutation line (e.g. "Dear Hiring Manager,", "To whom it may concern").
- The text contains no closing signature block — no sign-off phrase (e.g. "Sincerely,", "Best regards,", "Kind regards,") and no standalone candidate-name line at the end.
- The text contains no letterhead elements: no date line, no postal-address lines, no "Subject:"/"Re:" line.
- The text contains no bracketed placeholders (e.g. "[Hiring Manager]", "[Company Name]") — anything unknown is simply omitted.
- The text opens directly with first-person content about the candidate's fit for the role.
- Everything else about generation is unchanged: the best-matching profile is still selected, only facts from the profiles are used, and the user's global AI preferences still override the default style.
