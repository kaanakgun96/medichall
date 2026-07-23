import assert from "node:assert/strict";
import test from "node:test";
import {
  attachmentFileInfo,
  canonicalAttachmentUrl,
  documentTypeForAttachment,
  extractAttachmentCandidates,
  isPathAllowedByRobots,
  normalizePublicUrl,
} from "./attachment-discovery.ts";

test("resolves relative URLs and rejects unsafe targets", () => {
  assert.equal(
    normalizePublicUrl(
      "../files/specification.pdf",
      "https://buyer.gov.example/tenders/42/",
    )
      ?.href,
    "https://buyer.gov.example/tenders/files/specification.pdf",
  );
  assert.equal(normalizePublicUrl("file:///etc/passwd"), null);
  assert.equal(normalizePublicUrl("http://127.0.0.1/private.pdf"), null);
  assert.equal(normalizePublicUrl("http://[::1]/private.pdf"), null);
  assert.equal(
    normalizePublicUrl("https://user:pass@example.com/file.pdf"),
    null,
  );
});

test("canonicalizes query order and removes tracking without removing access parameters", () => {
  assert.equal(
    canonicalAttachmentUrl(
      "https://EXAMPLE.com:443/file.pdf?utm_source=news&signature=keep&b=2&a=1#page=2",
    ),
    "https://example.com/file.pdf?a=1&b=2&signature=keep",
  );
});

test("extracts, normalizes, deduplicates, and prioritizes official attachment links", () => {
  const candidates = extractAttachmentCandidates(
    `
      <a href="../../files/spec.pdf?utm_source=a">Technical specification</a>
      <a href="https://buyer.gov.example/files/spec.pdf">Duplicate specification</a>
      <a href="https://external.example/account/login">Sign in</a>
      <cbc:URI>https://buyer.gov.example/files/boq.xlsx</cbc:URI>
    `,
    "https://buyer.gov.example/notices/42/",
    "https://buyer.gov.example/notices/42/",
    1,
  );
  assert.equal(candidates.length, 3);
  assert.match(candidates[0].sourceUrl, /boq\.xlsx|spec\.pdf/);
  assert.ok(candidates[0].priorityScore > candidates.at(-1)!.priorityScore);
  assert.equal(candidates[0].confidence, "high");
});

test("detects supported files from path, MIME type, and content disposition", () => {
  assert.deepEqual(
    attachmentFileInfo(
      "https://example.com/download",
      "application/pdf",
      'attachment; filename="notice.pdf"',
    ),
    {
      extension: "pdf",
      fileName: "notice.pdf",
      mimeType: "application/pdf",
    },
  );
  assert.equal(
    attachmentFileInfo("https://example.com/spec.DOCX").mimeType,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  assert.equal(
    attachmentFileInfo("https://example.com/table.xlsx").extension,
    "xlsx",
  );
});

test("classifies document purposes without changing unknown files", () => {
  assert.equal(
    documentTypeForAttachment(
      "Technical specifications",
      "https://example.com/a.pdf",
    ),
    "technical_specification",
  );
  assert.equal(
    documentTypeForAttachment(
      "Commercial offer",
      "https://example.com/pricing.xlsx",
    ),
    "price_schedule",
  );
  assert.equal(
    documentTypeForAttachment("", "https://example.com/file.pdf"),
    "other",
  );
});

test("honors the longest matching robots rule", () => {
  const robots = `
    User-agent: *
    Disallow: /private/
    Allow: /private/public-procurement/
  `;
  assert.equal(isPathAllowedByRobots(robots, "/private/account"), false);
  assert.equal(
    isPathAllowedByRobots(robots, "/private/public-procurement/spec.pdf"),
    true,
  );
  assert.equal(isPathAllowedByRobots(robots, "/tenders/spec.pdf"), true);
});
