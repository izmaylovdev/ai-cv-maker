import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { setupAuth } from './support/auth';
import { API_URL, TEST_PROFILE_ID } from './support/constants';
import { registerFakeChatWidget } from './support/mocks/ai.mock';
import { mockProfileApi } from './support/mocks/profile.mock';
import { registerFakeProfileBuilder } from './support/mocks/builder.mock';

// The rest of the e2e suite fakes <ai-chat-widget>. This spec loads the REAL
// production bundle (dist/apps/chat-ui/chat-widget.js) to prove two things:
//   1. the widget renders Chat UI's composer (a textbox and a send button), and
//   2. its styles do not leak: the surrounding Angular page (nav, headings,
//      buttons, inputs, profile editor) computes exactly the same styles with the
//      real widget mounted as with an unstyled stand-in, in light and dark themes.
//
// Build the widget first:  npx vite build --config apps/chat-ui/vite.config.mts

const WIDGET_BUNDLE = resolve(__dirname, '../../../dist/apps/chat-ui/chat-widget.js');
const MISSING_BUNDLE_MESSAGE =
  'dist/apps/chat-ui/chat-widget.js is missing — build it with `npx vite build --config apps/chat-ui/vite.config.mts`';

const STYLE_PROPS = [
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'color',
  'background-color',
  'padding',
  'margin',
  'border-radius',
  'border-top-width',
  'box-shadow',
] as const;

type Styles = Record<string, Record<string, string>>;
type Scheme = 'light' | 'dark';
type Targets = (page: Page) => Record<string, Locator>;

async function computedStyles(targets: Record<string, Locator>): Promise<Styles> {
  const out: Styles = {};
  for (const [name, locator] of Object.entries(targets)) {
    await expect(locator, `target "${name}" should be visible`).toBeVisible();
    out[name] = await locator.evaluate(
      (el, props) => {
        const cs = getComputedStyle(el);
        return Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
      },
      [...STYLE_PROPS],
    );
  }
  return out;
}

async function newPage(browser: Browser, baseURL: string | undefined, scheme: Scheme, realWidget: boolean) {
  const context = await browser.newContext({
    baseURL,
    colorScheme: scheme,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  // Lowest-priority catch-all so nothing proxies to a live cv-api (which would
  // 401 the fake JWT and log the session out). Specific mocks are added later.
  await page.route(`${API_URL}/**`, (route) => route.fulfill({ json: {} }));
  await setupAuth(page);
  if (realWidget) {
    const body = readFileSync(WIDGET_BUNDLE, 'utf-8');
    await page.route('**/chat-widget.js', (route) =>
      route.fulfill({ body, contentType: 'application/javascript' }),
    );
  } else {
    // Unstyled stand-in: defines <ai-chat-widget> with no CSS at all.
    await registerFakeChatWidget(page);
  }
  return { context, page };
}

/** Settle colour transitions and park the pointer where it hovers nothing. */
async function settle(page: Page) {
  await page.mouse.move(2, 890);
  await page.waitForTimeout(400);
}

async function expectThemeApplied(page: Page, scheme: Scheme) {
  if (scheme === 'dark') await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/);
  else await expect(page.locator('html')).not.toHaveClass(/(^|\s)dark(\s|$)/);
}

const chatPageTargets: Targets = (page) => ({
  body: page.locator('body'),
  sidebar: page.locator('aside').first(),
  activeNavLink: page.getByRole('link', { name: /AI Assistant/i }),
  navLink: page.getByRole('link', { name: /Job Profiles/i }),
  themeButton: page.getByRole('button', { name: /(Dark|Light) Mode/i }),
  logoutButton: page.getByRole('button', { name: /Logout/i }),
  pageHeading: page.getByRole('heading', { name: 'AI Career Assistant' }),
  main: page.locator('main'),
});

const profilePageTargets: Targets = (page) => ({
  body: page.locator('body'),
  navLink: page.getByRole('link', { name: /Job Profiles/i }),
  backButton: page.getByRole('button', { name: 'Back to job profiles' }),
  profileTitle: page.getByRole('heading', { level: 1 }),
  pdfButton: page.getByTitle('Open PDF').first(),
  aiEditorToggle: page.getByRole('button', { name: 'AI Editor', exact: true }).first(),
  saveButton: page.getByRole('button', { name: /Save Profile/i }),
  chatPanelHeading: page.getByRole('heading', { name: 'AI Editor' }),
  chatPanelClose: page.getByRole('button', { name: 'Close AI editor' }),
  profileBuilder: page.locator('applysy-profile-builder'),
});

/** Relative luminance (0 = black, 1 = white) of the first opaque background up the tree. */
async function effectiveBackgroundLuminance(locator: Locator): Promise<number> {
  return locator.evaluate((start) => {
    const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
    for (let el: Element | null = start; el; el = el.parentElement) {
      const [r, g, b, a = 1] = parse(getComputedStyle(el).backgroundColor);
      if (a > 0.5) {
        const lin = (v: number) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      }
    }
    return 1; // default canvas is white
  });
}

test.describe('Chat widget — real bundle, style isolation', () => {
  test.skip(!existsSync(WIDGET_BUNDLE), MISSING_BUNDLE_MESSAGE);

  for (const scheme of ['light', 'dark'] as const) {
    test(`/chat (${scheme}): the widget renders a Chat UI composer and the page around it is unchanged`, async ({
      browser,
      baseURL,
    }) => {
      // BEFORE — unstyled stand-in widget.
      const before = await newPage(browser, baseURL, scheme, false);
      await before.page.goto('/chat');
      await expect(before.page.locator('ai-chat-widget')).toBeVisible();
      await expectThemeApplied(before.page, scheme);
      await settle(before.page);
      const baseline = await computedStyles(chatPageTargets(before.page));
      await before.context.close();

      // AFTER — the real widget mounted.
      const after = await newPage(browser, baseURL, scheme, true);
      await after.page.goto('/chat');
      const widget = after.page.locator('ai-chat-widget');
      await expect(widget.getByRole('textbox')).toBeVisible();
      // Soft: keep going so the isolation comparison below is reported too.
      await expect.soft(widget.locator('form button[type="submit"]')).toBeVisible();
      await expect.soft(widget.getByText(/how can i help you\?/i)).toBeVisible();
      await expectThemeApplied(after.page, scheme);
      await settle(after.page);
      const withWidget = await computedStyles(chatPageTargets(after.page));
      await after.context.close();

      expect(withWidget).toEqual(baseline);
    });

    test(`/job-profiles/:id (${scheme}): the AI Editor renders a Chat UI composer and the editor around it is unchanged`, async ({
      browser,
      baseURL,
    }) => {
      async function openEditorWithChat(realWidget: boolean) {
        const handle = await newPage(browser, baseURL, scheme, realWidget);
        await registerFakeProfileBuilder(handle.page);
        await mockProfileApi(handle.page);
        await handle.page.goto(`/job-profiles/${TEST_PROFILE_ID}`);
        await handle.page.getByRole('button', { name: /AI Editor/i }).first().click();
        await expect(handle.page.locator('app-profile ai-chat-widget')).toBeVisible();
        return handle;
      }

      // BEFORE — unstyled stand-in widget in the open AI Editor panel.
      const before = await openEditorWithChat(false);
      await expectThemeApplied(before.page, scheme);
      await settle(before.page);
      const baseline = await computedStyles(profilePageTargets(before.page));
      // An Angular input: the inline profile-name editor.
      await before.page.getByRole('heading', { level: 1 }).click();
      await settle(before.page);
      const baselineInput = await computedStyles({
        renameInput: before.page.getByRole('textbox', { name: 'Profile name' }),
      });
      await before.context.close();

      // AFTER — the real widget in the open AI Editor panel.
      const after = await openEditorWithChat(true);
      const widget = after.page.locator('app-profile ai-chat-widget');
      await expect(widget.getByRole('textbox')).toBeVisible();
      // Soft: keep going so the isolation comparison below is reported too.
      await expect.soft(widget.locator('form button[type="submit"]')).toBeVisible();
      await expect.soft(widget.getByText(/ask me to edit your cv/i)).toBeVisible();
      await expectThemeApplied(after.page, scheme);
      await settle(after.page);
      const withWidget = await computedStyles(profilePageTargets(after.page));
      await after.page.getByRole('heading', { level: 1 }).click();
      await settle(after.page);
      const withWidgetInput = await computedStyles({
        renameInput: after.page.getByRole('textbox', { name: 'Profile name' }),
      });
      await after.context.close();

      expect(withWidget).toEqual(baseline);
      expect(withWidgetInput).toEqual(baselineInput);
    });
  }

  test("the widget follows the app's light/dark theme", async ({ browser, baseURL }) => {
    const luminance: Partial<Record<Scheme, { composer: number }>> = {};
    for (const scheme of ['light', 'dark'] as const) {
      const { context, page } = await newPage(browser, baseURL, scheme, true);
      await page.goto('/chat');
      const textbox = page.locator('ai-chat-widget').getByRole('textbox');
      await expect(textbox).toBeVisible();
      await expectThemeApplied(page, scheme);
      await settle(page);
      luminance[scheme] = { composer: await effectiveBackgroundLuminance(textbox) };
      await context.close();
    }
    // Light theme: a light composer; dark theme: a dark one.
    expect(luminance.light!.composer).toBeGreaterThan(0.5);
    expect(luminance.dark!.composer).toBeLessThan(0.2);
  });
});
