import { createClient } from "npm:@supabase/supabase-js@2.39.8";

export type LifecycleDeps = {
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  fetch?: typeof fetch;
  rpc?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>;
};

export function createLifecycleRpc(deps: LifecycleDeps) {
  if (deps.rpc) return deps.rpc;
  const url = deps.supabaseUrl ?? Deno.env.get("SUPABASE_URL");
  const key = deps.supabaseServiceRoleKey ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url?.trim() || !key?.trim()) {
    throw new Error("Missing lifecycle database configuration.");
  }
  const client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { ...(deps.fetch ? { fetch: deps.fetch } : {}) },
  });
  return async (name: string, args: Record<string, unknown>) =>
    await client.rpc(name, args);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
