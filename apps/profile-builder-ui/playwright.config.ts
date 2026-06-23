import { defineConfig, devices } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';
import { workspaceRoot } from '@nx/devkit';

// The profile-builder-ui is a self-contained web component. Its standalone dev
// shell (index.html, seeded with SAMPLE_DOCUMENT) renders the REAL component —
// unlike the Angular e2e suite, which mocks it (registerFakeProfileBuilder). So
// interaction-level behaviour like section drag-and-drop is exercised here,
// against the dev shell on port 4288.
const PORT = 4288;
const baseURL = process.env['BASE_URL'] || `http://localhost:${PORT}`;

export default defineConfig({
  ...nxE2EPreset(__filename, { testDir: './e2e' }),
  // The reorder tests each mutate the one dev-server-seeded document and the
  // single Vite dev server compiles on demand; run them serially so they are
  // deterministic rather than racing parallel page loads.
  fullyParallel: false,
  workers: 1,
  // One retry absorbs the dev server's first-request cold compile, which can
  // exceed the per-action timeout on an otherwise idle machine.
  retries: 1,
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `npx nx run profile-builder-ui:dev --port=${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env['CI'],
    cwd: workspaceRoot,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      // Override the device's 720px height: the whole seeded document (all
      // section handles) must fit the viewport, since page.mouse clamps to it
      // and an off-screen handle could not be pressed.
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 1200 } },
    },
  ],
});
