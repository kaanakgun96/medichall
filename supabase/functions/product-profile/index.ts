/// <reference path="../_shared/edge-runtime.d.ts" />

// deno-lint-ignore no-import-prefix -- Edge bundle pins the production client.
import { createClient } from "npm:@supabase/supabase-js@2.110.8";
import { stableVersionHash } from "../_shared/matching-observability.ts";
import {
  calculateProductReadiness,
  PRODUCT_PROFILE_VERSION,
} from "../_shared/product-profile-v1.ts";
import {
  backfillUpdateForProduct,
  buildBackfillReport,
  validateProductWrite,
} from "../_shared/product-profile-service.ts";

const ALLOWED_ORIGINS = new Set([
  "https://medichall.com",
  "https://www.medichall.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin)
      ? origin
      : "https://medichall.com",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function integer(value: unknown): number | null {
  const result = Number(value);
  return Number.isInteger(result) && result > 0 ? result : null;
}

async function reportHash(
  report: ReturnType<typeof buildBackfillReport>,
): Promise<string> {
  return await stableVersionHash(
    report.changes.map((change) => ({
      product_id: change.product_id,
      proposed_values: change.proposed_values,
    })),
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed." }, 405);
  }
  const requestOrigin = req.headers.get("origin");
  if (requestOrigin && !ALLOWED_ORIGINS.has(requestOrigin)) {
    return json(req, { error: "Origin not allowed." }, 403);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    return json(req, { error: "Product profiles are not configured." }, 500);
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.toLocaleLowerCase().startsWith("bearer ")) {
    return json(req, { error: "Authentication required." }, 401);
  }
  const token = authHeader.slice(7).trim();
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser(token);
  if (authError || !user) {
    return json(req, { error: "Invalid or expired session." }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = record(await req.json());
  } catch {
    return json(req, { error: "Invalid JSON body." }, 400);
  }
  const action = String(payload.action ?? "");
  if (
    ![
      "list",
      "save",
      "backfill_preview",
      "backfill_apply",
    ].includes(action)
  ) {
    return json(req, { error: "Unsupported action." }, 400);
  }
  const companyId = integer(payload.company_id);
  if (!companyId) {
    return json(req, { error: "A valid company_id is required." }, 400);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [{ data: ownedCompany }, { data: isAdmin }] = await Promise.all([
    userClient.from("companies").select("id").eq("id", companyId).eq(
      "owner_id",
      user.id,
    ).maybeSingle(),
    userClient.rpc("is_admin"),
  ]);
  if (!ownedCompany && isAdmin !== true) {
    return json(req, { error: "Access denied." }, 403);
  }

  if (action === "save") {
    const productId = integer(payload.product_id);
    if (
      payload.product_id != null &&
      payload.product_id !== "" &&
      !productId
    ) {
      return json(req, { error: "A valid product_id is required." }, 400);
    }
    let validated;
    try {
      validated = validateProductWrite(payload.product, companyId);
    } catch (error) {
      return json(req, {
        error: error instanceof Error ? error.message : "Invalid product.",
      }, 400);
    }
    const mutation = productId
      ? userClient.from("products").update(validated.row).eq("id", productId)
        .eq("company_id", companyId)
      : userClient.from("products").insert(validated.row);
    const { data, error } = await mutation.select("*").maybeSingle();
    if (error) {
      const duplicate = error.code === "23505";
      return json(req, {
        error: duplicate
          ? "This product code already exists in the catalog."
          : "The product could not be saved.",
      }, duplicate ? 409 : 400);
    }
    if (!data) return json(req, { error: "Product not found." }, 404);
    return json(req, {
      product: data,
      readiness: calculateProductReadiness(data),
      profile_version: PRODUCT_PROFILE_VERSION,
    });
  }

  const { data: productRows, error: productsError } = await userClient.from(
    "products",
  ).select("*").eq("company_id", companyId).order("ref", {
    ascending: true,
  });
  if (productsError) {
    return json(req, { error: "Products could not be loaded." }, 400);
  }
  const products = (productRows ?? []) as Record<string, unknown>[];
  if (action === "list") {
    return json(req, {
      products: products.map((product) => ({
        ...product,
        matching_readiness: calculateProductReadiness(product),
      })),
      profile_version: PRODUCT_PROFILE_VERSION,
    });
  }

  const report = buildBackfillReport(products);
  const previewHash = await reportHash(report);
  if (action === "backfill_preview") {
    return json(req, {
      ...report,
      preview_hash: previewHash,
      mode: "dry_run",
      applied_count: 0,
    });
  }

  if (
    typeof payload.preview_hash !== "string" ||
    payload.preview_hash !== previewHash
  ) {
    return json(req, {
      error:
        "Backfill data changed. Run backfill_preview again before applying.",
    }, 409);
  }
  const requestedIds = Array.isArray(payload.product_ids)
    ? payload.product_ids.map(integer).filter(
      (value): value is number => value != null,
    )
    : [];
  if (!requestedIds.length || requestedIds.length > 100) {
    return json(req, {
      error: "Choose between 1 and 100 product IDs from the dry-run report.",
    }, 400);
  }
  const allowedIds = new Set(
    report.changes
      .filter((change) => change.safely_derived_fields.length > 0)
      .map((change) => change.product_id),
  );
  if (requestedIds.some((id) => !allowedIds.has(id))) {
    return json(req, {
      error: "The apply request contains a product not in the dry-run report.",
    }, 400);
  }

  const updated: number[] = [];
  for (const productId of [...new Set(requestedIds)]) {
    const product = products.find((item) => Number(item.id) === productId);
    if (!product) continue;
    const update = backfillUpdateForProduct(product);
    const { data, error } = await userClient.from("products").update(update)
      .eq("id", productId).eq("company_id", companyId).select("id")
      .maybeSingle();
    if (error || !data) {
      return json(req, {
        error: "Backfill stopped because a product could not be updated.",
        applied_product_ids: updated,
      }, 409);
    }
    updated.push(productId);
  }
  return json(req, {
    mode: "applied",
    preview_hash: previewHash,
    applied_count: updated.length,
    applied_product_ids: updated,
  });
});
