# AI Enhancement & Optimization

## Overview

The application embeds AI assistance at two levels: fine-grained (improve a single text field) and holistic (rewrite the entire profile for a specific target role). Both features are non-destructive — the user reviews suggestions and decides whether to accept them.

---

## User Stories

### US-AI-1 — Enhance a single text field

**As a** user editing a text field (e.g., a work experience description or professional summary),
**I want to** click an "Enhance" button next to the field and have the AI improve the text,
**so that** my content sounds more professional without me having to rewrite it from scratch.

**Acceptance criteria:**
- An enhance button is visible on all multi-line text inputs.
- The AI rewrites the field content while preserving all factual information (dates, company names, technologies).
- The enhanced text replaces the original in the field; I can undo by typing or clearing.
- A loading indicator is shown while the AI is working.
- If the request fails, an error notification is shown and the original text is preserved.

---

### US-AI-2 — Optimize the full profile for a target role

**As a** user who knows the type of role I am applying for,
**I want to** describe my target (e.g., "Senior React developer at a fintech startup") and have the AI rewrite my entire profile to highlight the most relevant aspects,
**so that** my CV resonates with that specific audience without me having to manually edit every field.

**Acceptance criteria:**
- A dedicated "Optimize" or "Optimize for role" action is available on the profile page.
- I enter a free-text description of my target role/goal.
- The AI returns:
  - A refined professional title
  - A rewritten overview/summary
  - Improved work experience descriptions emphasizing relevant achievements
  - A prioritized and normalized skills list (most relevant first)
- I can review all suggested changes before applying.
- I can accept or discard the changes.
- Factual data (company names, job titles, dates) is never altered by the AI.

---

### US-AI-3 — See AI suggestions without losing original content

**As a** user reviewing AI-optimized content,
**I want to** compare the AI suggestion with my original text,
**so that** I can make an informed decision about whether to keep the suggestion.

**Acceptance criteria:**
- The review step shows both the original and AI-suggested versions side-by-side or sequentially.
- Discarding reverts the field to its pre-optimization state with no data loss.

---

### US-AI-4 — Chat with AI to edit profile and ask questions

**As a** user managing my CV profile,
**I want to** open a chat interface where I can ask questions about my profile and instruct the AI to make edits through natural conversation,
**so that** I can refine my profile quickly without navigating individual form fields.

**Acceptance criteria:**
- A dedicated "Chat" page is accessible from the main navigation.
- I can send free-text messages to an AI assistant.
- The AI can answer questions about my profile (e.g., "What skills do I have listed?", "How many years of experience do I have?").
- I can instruct the AI to edit my profile through natural language (e.g., "Add Python to my skills", "Update my summary to mention leadership experience").
- The AI proposes each change before applying it; I confirm or reject.
- Applied changes are immediately reflected in my profile and persisted.
- The chat history is shown in the current session (scrollable, most recent at bottom).
- A loading indicator appears while the AI is responding.
- If the request fails, an error message is shown in the chat and the profile is unchanged.

---

### US-AI-5 — Optimize profile for a specific job posting via URL

**As a** job seeker who has found a specific job posting I want to apply for,
**I want to** paste the URL of the job posting into the optimize prompt and have the AI fetch and use the actual job description for optimization,
**so that** my CV is tailored precisely to that vacancy rather than a generic role description I type by hand.

**Acceptance criteria:**
- The user types or pastes their target into the existing free-text field in the "Optimize with AI" dialog — either a plain role description (e.g. "Senior React developer at a fintech startup") or a job posting URL.
- The LLM inspects the input: if it contains a URL, it calls a fetch tool to retrieve the page and extract the job description before running optimization.
- The AI uses the extracted job description (title, responsibilities, required skills) as the optimization target.
- If the fetch fails or the page contains no recognizable job content, the AI proceeds using the raw input text as the role description.
- The rest of the optimization review flow (suggestions, accept/discard) is unchanged.

### US-AI-6 — Track LLM spending per user

**As a** platform administrator,
**I want to** see how many LLM tokens each user has consumed and the associated estimated cost,
**so that** I can monitor spending, identify heavy users, and make informed decisions about pricing or quotas.

**Acceptance criteria:**
- Every LLM call (CV generate, optimize, enhance field, extract, chat, cover letter, user chat) records the prompt tokens, completion tokens, and model name against the requesting user.
- Token counts are persisted in the database per user per request.
- Cost is derived on-the-fly from a configurable price-per-token table (stored in `appsettings.json`, keyed by model name, separate rates for prompt vs. completion tokens).
- The admin panel exposes an endpoint listing all users with their aggregate token usage and estimated cost in USD.
- A user-facing `/settings/usage` page shows the current user's own total prompt tokens, completion tokens, and estimated cost to date.
