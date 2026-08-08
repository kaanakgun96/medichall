import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const activeHtmlPages = [
  "index.html",
  "companies.html",
  "products.html",
  "tenders.html",
  "matchmaking.html",
  "portal.html",
  "admin.html",
];

for (const page of activeHtmlPages) {
  const source = await readFile(resolve(repositoryRoot, page), "utf8");
  assert.equal((source.match(/<medichall-header\b/g) || []).length, 1, `${page} must render one shared header`);
  assert.equal((source.match(/medichall-design-system\.css/g) || []).length, 1, `${page} must load the shared stylesheet once`);
  assert.equal((source.match(/medichall-navigation\.js/g) || []).length, 1, `${page} must load the shared navigation once`);
  assert.equal((source.match(/<header(?:\s|>)/gi) || []).length, 0, `${page} must not carry a duplicate page header`);
  assert.match(source, /family=Poppins/, `${page} must use the canonical interface typeface`);
}

const navigation = await readFile(resolve(repositoryRoot, "medichall-navigation.js"), "utf8");
assert.match(navigation, /customElements\.define\("medichall-header"/, "shared navigation must register the header element");
for (const requiredId of ["authArea", "headActions", "navActions", "portalNotificationBell", "notificationBell", "profileTrigger"]) {
  assert.match(navigation, new RegExp(`id=\\"${requiredId}\\"`), `shared navigation must preserve #${requiredId}`);
}
assert.match(navigation, /new MutationObserver/, "dynamic tables, forms, dialogs, and states must receive progressive enhancements");

const designSystem = await readFile(resolve(repositoryRoot, "medichall-design-system.css"), "utf8");
for (const token of ["--ink", "--teal", "--mint", "--mist", "--line", "--danger", "--success", "--shadow", "--radius"]) {
  assert.match(designSystem, new RegExp(`${token}:`), `shared design system must define ${token}`);
}
for (const variant of ["primary", "secondary", "quiet", "danger", "success", "small", "large"]) {
  assert.match(designSystem, new RegExp(`\\.button--${variant}`), `shared button system must define ${variant}`);
}
for (const breakpoint of [1120, 1240, 680, 390]) {
  assert.match(designSystem, new RegExp(`max-width: ${breakpoint}px`), `shared design system must cover ${breakpoint}px`);
}
assert.match(designSystem, /prefers-reduced-motion: reduce/, "shared design system must respect reduced-motion preferences");

const products = await readFile(resolve(repositoryRoot, "products.html"), "utf8");
assert.match(products, /\.catalog>\.side\{grid-column:1\}/, "product filters must stay in the desktop sidebar column");
assert.match(products, /\.catalog>main\{grid-column:2;min-width:0\}/, "product results must stay in the flexible desktop column");
assert.doesNotMatch(products, /grid-column:1\/-1;display:contents/, "product filter toggle must not rely on ambiguous display:contents grid placement");

const reactHeader = await readFile(resolve(repositoryRoot, "apps/portal-react/src/shared/components/PortalHeader.tsx"), "utf8");
const reactEntry = await readFile(resolve(repositoryRoot, "apps/portal-react/src/main.tsx"), "utf8");
const reactStyles = await readFile(resolve(repositoryRoot, "apps/portal-react/src/app/styles.css"), "utf8");
assert.match(reactHeader, /createElement\("medichall-header"/, "React must render the shared header element");
assert.match(reactEntry, /medichall-navigation\.js/, "React must bundle the shared navigation implementation");
assert.match(reactStyles, /medichall-design-system\.css/, "React must import the shared design system");
assert.doesNotMatch(reactStyles, /^:root\s*\{/m, "React must not redefine the canonical token root");

console.log(`UI design-system check passed for ${activeHtmlPages.length} HTML pages and the React portal.`);
