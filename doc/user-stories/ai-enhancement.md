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
