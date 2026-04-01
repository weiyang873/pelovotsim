async function assertStable(page, selector, options = {}) {
  const duration = Number(options.duration || 2000);
  const checkInterval = Number(options.checkInterval || 200);
  const locator = page.locator(selector);
  const checks = Math.max(1, Math.ceil(duration / checkInterval));

  for (let index = 0; index < checks; index += 1) {
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) {
      throw new Error(`Element became hidden during stability check: ${selector}`);
    }
    if (index < checks - 1) {
      await page.waitForTimeout(checkInterval);
    }
  }
}

async function assertStablyHidden(page, selector, options = {}) {
  const duration = Number(options.duration || 2000);
  const checkInterval = Number(options.checkInterval || 200);
  const locator = page.locator(selector);
  const checks = Math.max(1, Math.ceil(duration / checkInterval));

  for (let index = 0; index < checks; index += 1) {
    const visible = await locator.isVisible().catch(() => false);
    if (visible) {
      throw new Error(`Element became visible during hidden stability check: ${selector}`);
    }
    if (index < checks - 1) {
      await page.waitForTimeout(checkInterval);
    }
  }
}

async function countDOMMutations(page, selector, options = {}) {
  const duration = Number(options.duration || 3000);
  const checkInterval = Number(options.checkInterval || 200);
  const key = `__codexMutationCounter_${Math.random().toString(36).slice(2)}`;

  const attached = await page.evaluate(({ selector: targetSelector, key: observerKey }) => {
    const target = document.querySelector(targetSelector);
    if (!target) return false;
    window[observerKey] = { count: 0 };
    const observer = new MutationObserver((mutations) => {
      window[observerKey].count += mutations.length;
    });
    observer.observe(target, {
      childList: true,
      attributes: true,
      subtree: true
    });
    window[observerKey].observer = observer;
    return true;
  }, { selector, key });

  if (!attached) {
    throw new Error(`Mutation target not found: ${selector}`);
  }

  const checks = Math.max(1, Math.ceil(duration / checkInterval));
  for (let index = 0; index < checks; index += 1) {
    await page.waitForTimeout(checkInterval);
  }

  return page.evaluate((observerKey) => {
    const state = window[observerKey];
    if (!state) return 0;
    const count = Number(state.count || 0);
    if (state.observer) state.observer.disconnect();
    delete window[observerKey];
    return count;
  }, key);
}

module.exports = {
  assertStable,
  assertStablyHidden,
  countDOMMutations
};
