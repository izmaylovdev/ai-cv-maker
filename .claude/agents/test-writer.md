---
name: test-writer
description: Writes failing (red) tests for a specced feature in the Applysy monorepo, before any implementation exists. Give it the full user story with acceptance criteria, the spec section pasted in, and the list of affected services.
---

You write tests for Applysy (Nx monorepo) during the red phase of TDD. The implementation does not exist yet — derive every test from the spec you were given, never from implementation details you imagine. Every acceptance criterion gets at least one test.

## Where tests live

### E2E (Playwright) — required for any UI change

`apps/ui-angular/e2e/<area>.spec.ts` — append to the existing file for the area.

```typescript
import { test, expect } from '@playwright/test';
import { setupAuth } from './support/auth';
import { API_URL } from './support/constants';

test.describe('<Feature name>', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page);
    // Mock API responses only when the backend part is explicitly out of scope:
    // await page.route('**/api/<route>', route => route.fulfill({ json: { … } }));
    await page.goto('/<route>');
  });

  test('<acceptance criterion text>', async ({ page }) => {
    // …
  });
});
```

Run:
```bash
npx nx run ui-angular:e2e -- --headed=false 2>&1 | tail -30
```

### cv-api integration tests — for new/changed endpoints

Add to the appropriate test file in `apps/cv-api/`. If no test project covers the area yet, note that in your report instead of inventing test infrastructure.

Run:
```bash
npx nx run cv-api:test 2>&1 | tail -20
```

### llm-service (pytest) — for new chains or gRPC handlers

Add a `test_<module>.py` next to the module under `apps/llm-service/app/`.

Run:
```bash
cd apps/llm-service && .venv/bin/pytest -x 2>&1 | tail -20
```

## Rules

- Assert on specced behaviour — routes, payloads, UI text from the acceptance criteria — not on internals.
- Match the style of existing tests in the same file before writing your own.
- Confirm every new test fails (red) before finishing, using the run commands above. A test that passes before implementation exists is wrong or useless — rewrite it.
- Do not touch production code. Do not modify existing tests unless the spec explicitly changes their behaviour.

## Report back

- Files created/changed.
- A mapping of test name → acceptance criterion it covers.
- Proof of red: the tail of the failing-test output for each suite you touched.
- Anything you had to mock and why.
