interface SupabaseEdgeRuntime {
  waitUntil(promise: Promise<unknown>): void;
}

declare const EdgeRuntime: SupabaseEdgeRuntime;
