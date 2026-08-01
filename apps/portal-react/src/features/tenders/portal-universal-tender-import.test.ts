import { describe, expect, it } from "vitest";
import portal from "../../../../../portal.html?raw";
import hardeningMigration from "../../../../../supabase/migration-archive/universal-tender-import/202607290002_universal_tender_import_hardening.sql?raw";
import archiveWorker from "../../../../../supabase/functions/tender-archive-worker/index.ts?raw";
import tenderImportHandler from "../../../../../supabase/functions/tender-import/handler.ts?raw";

describe("production Universal Tender Import hardening", () => {
  it("keeps the production portal inline JavaScript parseable", () => {
    const inlineScripts = [...portal.matchAll(
      /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi,
    )].map((match) => match[1]);
    expect(inlineScripts.length).toBeGreaterThan(0);
    expect(() => new Function(inlineScripts.join("\n"))).not.toThrow();
  });

  it("contains no duplicate static HTML identifiers", () => {
    const markup = portal.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
    const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("implements complete tab, panel, progress, and live-region semantics", () => {
    expect(portal).toContain(
      'role="tablist" aria-label="Tender import source"',
    );
    expect(portal).toContain('id="tiFilesMode" role="tab"');
    expect(portal).toContain('aria-controls="tiFilesPanel"');
    expect(portal).toContain('aria-controls="tiUrlPanel"');
    expect(portal).toContain('id="tiFilesPanel" role="tabpanel"');
    expect(portal).toContain('id="tiUrlPanel" role="tabpanel"');
    expect(portal).toContain("handleTenderImportTabKey(event)");
    expect(portal).toContain('event.key === "ArrowRight"');
    expect(portal).toContain('event.key === "ArrowLeft"');
    expect(portal).toContain('event.key === "Home"');
    expect(portal).toContain('event.key === "End"');
    expect(portal).toContain('role="progressbar"');
    expect(portal).toContain('aria-valuemin="0"');
    expect(portal).toContain('aria-valuemax="100"');
    expect(portal).toContain('aria-valuenow="');
    expect(portal).toContain('aria-atomic="true"');
    expect(portal).toContain('aria-label="Retry import ');
  });

  it("provides a keyboard upload equivalent without nested interactive roles", () => {
    expect(portal).toContain(
      'type="button" onclick="document.getElementById(\'tiFiles\').click()">Choose files',
    );
    expect(portal).not.toContain(
      'id="tiDrop" role="button"',
    );
  });

  it("uses company-scoped content idempotency and exact upload cleanup", () => {
    expect(portal).toContain("tenderImportFileFingerprint");
    expect(portal).toContain('"uti-files-" + sourceFingerprint');
    expect(portal).toContain('"uti-url-" + sourceFingerprint');
    expect(portal).toContain("if(created.replayed)");
    expect(portal).toContain(
      'db("rpc/reopen_universal_tender_file_import"',
    );
    expect(portal).toContain('action:"cleanup"');
    expect(portal).toContain("storage_paths:storagePaths");
    expect(hardeningMigration).toContain(
      "create unique index if not exists tender_imports_company_source_unique",
    );
    expect(hardeningMigration).toContain(
      "pg_advisory_xact_lock",
    );
    expect(tenderImportHandler).toContain(
      "tenderImportFileSetFingerprint",
    );
    expect(tenderImportHandler).toContain(
      "actualFingerprint !== expectedFingerprint",
    );
  });

  it("fully qualifies Storage object paths and preserves RPC-only mutation", () => {
    expect(hardeningMigration.match(/storage\.objects\.name/g)?.length)
      .toBeGreaterThanOrEqual(20);
    expect(hardeningMigration).toContain(
      "revoke all on table public.tender_imports\nfrom public, anon, authenticated",
    );
    expect(hardeningMigration).toContain(
      "grant select on table public.tender_imports to authenticated",
    );
  });

  it("does not hide viewport overflow and contains wide controls locally", () => {
    expect(portal).not.toMatch(/body\s*\{[^}]*overflow-x\s*:\s*hidden/i);
    expect(portal).toContain(".tabs{flex-wrap:nowrap;overflow-x:auto");
    expect(portal).toContain(".wrap{padding-left:12px;padding-right:12px}");
    expect(portal).toContain("#headActions .marketplace-link");
  });

  it("keeps privileged secrets and unbounded ZIP decompression out of browser and worker source", () => {
    expect(portal).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(portal).not.toContain("DAILY_API_KEY");
    expect(archiveWorker).not.toContain("unzipSync");
    expect(archiveWorker).toContain("extractZipArchiveBounded");
    expect(archiveWorker).toContain("safeFetchWithRedirects");
  });
});
