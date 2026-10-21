import { Page, expect } from '@playwright/test';

/**
 * Attaches listeners to a Playwright page to detect console errors and unhandled exceptions.
 * Fails test immediately if an error is detected.
 */
export function setupConsoleGuard(page: Page): { getErrors: () => string[] } {
  const errors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore benign favicon or font 404s if any
      if (!text.includes('favicon.ico')) {
        errors.push(`Console Error: ${text}`);
      }
    }
  });

  page.on('pageerror', (err) => {
    errors.push(`Unhandled Page Error: ${err.message}\nStack: ${err.stack}`);
  });

  return {
    getErrors: () => errors,
  };
}

export function assertNoConsoleErrors(guard: { getErrors: () => string[] }) {
  const errors = guard.getErrors();
  expect(errors, `Expected zero console and page errors, but found:\n${errors.join('\n')}`).toEqual([]);
}
