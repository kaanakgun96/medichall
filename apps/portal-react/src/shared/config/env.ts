export class SupabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupabaseConfigurationError";
  }
}

export type PublicAppConfig = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  legacyPortalUrl: string;
};

let cachedConfig: PublicAppConfig | null = null;

function hasServiceRoleClaim(key: string): boolean {
  if (key.startsWith("sb_secret_")) return true;
  const parts = key.split(".");
  if (parts.length !== 3) return false;

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded)) as {
      role?: string;
    };
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

export function getPublicAppConfig(): PublicAppConfig {
  if (cachedConfig) return cachedConfig;

  const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
  const supabasePublishableKey = String(
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
  ).trim();
  const legacyPortalUrl = String(import.meta.env.VITE_LEGACY_PORTAL_URL ?? "/portal.html");

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new SupabaseConfigurationError(
      "Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. Copy .env.example to .env.local and restart the app.",
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    throw new SupabaseConfigurationError("VITE_SUPABASE_URL must be a valid URL.");
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.hostname !== "localhost") {
    throw new SupabaseConfigurationError("VITE_SUPABASE_URL must use HTTPS.");
  }

  if (hasServiceRoleClaim(supabasePublishableKey)) {
    throw new SupabaseConfigurationError(
      "A service-role or secret key was provided to the browser app. Use only the Supabase publishable/anon key.",
    );
  }

  cachedConfig = { supabaseUrl, supabasePublishableKey, legacyPortalUrl };
  return cachedConfig;
}
