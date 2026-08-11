import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const publicPages = ["index.html", "products.html", "companies.html"];
const assistant = read("medichall-assistant.js");
const assistantCss = read("medichall-assistant.css");
const portal = read("portal.html");

test("public Ask MedicHall entry points use one cache-busted canonical component", () => {
  for (const page of publicPages) {
    const source = read(page);
    const version = page === "index.html" ? "20260810beta1" : page === "products.html" ? "20260811scroll1" : "20260811tax1";
    assert.equal((source.match(new RegExp(`medichall-assistant\\.js\\?v=${version}`, "g")) || []).length, 1, `${page} must load canonical assistant JS once`);
    assert.equal((source.match(new RegExp(`medichall-assistant\\.css\\?v=${version}`, "g")) || []).length, 1, `${page} must load canonical assistant CSS once`);
    assert.doesNotMatch(source, /mha-|mhaToggle|mhaSend|mhaPanel|catalog-powered, no external AI/, `${page} retains legacy assistant code`);
  }
});

test("products and showrooms pass explicit public context without claiming tender evidence", () => {
  const products = read("marketplace-products.js");
  const companies = read("marketplace-companies.js");
  assert.match(products, /MedicHallAssistant\?\.setContext\(\{\s*kind: "product"/);
  assert.match(companies, /kind: "company"/);
  assert.match(assistant, /Tender-document evidence is not available in this product view/);
  assert.match(assistant, /company-supplied catalog fields, not tender-document evidence/);
});

test("canonical assistant shares branding, interaction, error and responsive contracts", () => {
  for (const marker of [
    "Ask MedicHall", "mh-assistant__mark", "mh-assistant__messages",
    "aria-live", "Start a new conversation", "Close Ask MedicHall",
  ]) assert.match(assistant, new RegExp(marker));
  assert.match(assistantCss, /mh-assistant__message--loading/);
  assert.match(assistantCss, /mh-assistant__message--error/);
  assert.match(assistantCss, /@media\(max-width:480px\)/);
  assert.match(assistantCss, /prefers-reduced-motion:reduce/);
  assert.match(assistantCss, /focus-visible/);
});

test("public AI fallback is single-flight and cached while tender Ask remains cited and scoped", () => {
  assert.match(assistant, /__mhAssistantFlights/);
  assert.match(assistant, /sessionStorage\.getItem\(key\)/);
  assert.match(assistant, /sessionStorage\.setItem\(key, reply\)/);
  assert.match(portal, /medichall-assistant\.css\?v=20260810beta1/);
  assert.match(portal, /Ask MedicHall about this tender/);
  assert.match(portal, /Cached answer · no new AI request/);
  assert.match(portal, /tender-ask-citations/);
  assert.match(portal, /tender-ask-chips mh-assistant__chips/);
  assert.match(portal, /tender-ask-form mh-assistant__form/);
  assert.match(portal, /resetTenderAsk/);
  assert.match(portal, /closeTenderAsk/);
  assert.match(portal, /company_id:COMPANY\.id,tender_id:Number\(tenderId\),question/);
});
