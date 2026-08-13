import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [page, styles, behavior] = await Promise.all([
  readFile(resolve(root, "products.html"), "utf8"),
  readFile(resolve(root, "marketplace-enterprise.css"), "utf8"),
  readFile(resolve(root, "marketplace-products.js"), "utf8"),
]);

test("product detail uses one bounded inner vertical scroll region", () => {
  assert.match(behavior, /class="marketplace-detail__scroll" tabindex="0"/);
  assert.match(styles, /\.marketplace-detail__scroll\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(styles, /\.marketplace-detail__scroll\s*\{[^}]*overscroll-behavior:\s*contain/s);
  assert.match(styles, /\.marketplace-detail\s*\{[^}]*overflow:\s*hidden/s);
  assert.doesNotMatch(styles, /body\s*\{[^}]*overflow:\s*auto/s);
});

test("mobile detail uses dynamic viewport and safe-area boundaries", () => {
  assert.match(styles, /\.marketplace-detail\s*\{[^}]*100dvh/s);
  assert.match(styles, /safe-area-inset-top/);
  assert.match(styles, /safe-area-inset-right/);
  assert.match(styles, /safe-area-inset-bottom/);
  assert.match(styles, /touch-action:\s*pan-y/);
});

test("dialog keyboard and focus contracts remain explicit", () => {
  assert.match(behavior, /event\.key === "Escape"/);
  assert.match(behavior, /event\.key !== "Tab"/);
  assert.match(behavior, /detailReturnFocus/);
  assert.match(behavior, /focus\(\{ preventScroll: true \}\)/);
  assert.match(page, /role="dialog" aria-modal="true" aria-labelledby="dTitle"/);
});

test("latest products bundle has an isolated cache identifier", () => {
  assert.match(page, /marketplace-enterprise\.css\?v=20260813traffic1/);
  assert.match(page, /marketplace-products\.js\?v=20260813traffic1/);
});
