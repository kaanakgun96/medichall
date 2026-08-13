import { handleMeetingVideoRequest } from "./index.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`Expected ${right}, received ${left}`);
}

function withVideoEnvironment(test: () => Promise<void>): Promise<void> {
  const names = [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "MEETING_VIDEO_PROVIDER",
    "DAILY_API_KEY",
  ];
  const original = new Map(names.map((name) => [name, Deno.env.get(name)]));
  Deno.env.set("SUPABASE_URL", "https://meeting-video-test.supabase.co");
  Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
  Deno.env.set("MEETING_VIDEO_PROVIDER", "daily");
  Deno.env.set("DAILY_API_KEY", "test-daily-key");
  return test().finally(() => {
    for (const [name, value] of original) {
      if (value == null) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  });
}

function joinRequest(): Request {
  return new Request("https://medichall.com/functions/v1/meeting-video", {
    method: "POST",
    headers: {
      origin: "https://medichall.com",
      authorization: "Bearer participant-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({ action: "join", meeting_id: 42 }),
  });
}

Deno.test("meeting video preflight is 204 and unauthenticated POST is 401", async () => {
  const options = await handleMeetingVideoRequest(
    new Request(
      "https://medichall.com/functions/v1/meeting-video",
      { method: "OPTIONS", headers: { origin: "https://medichall.com" } },
    ),
  );
  assertEquals(options.status, 204);

  await withVideoEnvironment(async () => {
    const unauthenticated = await handleMeetingVideoRequest(
      new Request(
        "https://medichall.com/functions/v1/meeting-video",
        {
          method: "POST",
          headers: { origin: "https://medichall.com" },
          body: "{}",
        },
      ),
    );
    assertEquals(unauthenticated.status, 401);
  });
});

Deno.test("authenticated early join returns explicit 425 without a Daily call", async () => {
  await withVideoEnvironment(async () => {
    const originalFetch = globalThis.fetch;
    let authCalls = 0;
    let authorizationCalls = 0;
    let dailyCalls = 0;
    globalThis.fetch = async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/auth/v1/user")) {
        authCalls += 1;
        return Response.json({ id: "84000000-0000-4000-8000-000000000001" });
      }
      if (url.includes("/rest/v1/rpc/authorize_matchmaking_video_action")) {
        authorizationCalls += 1;
        const start = Date.now() + 16 * 60_000;
        return Response.json({
          can_join: false,
          status: "confirmed",
          video_status: "ready",
          start_at: new Date(start).toISOString(),
          end_at: new Date(start + 30 * 60_000).toISOString(),
        });
      }
      if (url.includes("api.daily.co")) dailyCalls += 1;
      throw new Error(`Unexpected request: ${url}`);
    };
    try {
      const response = await handleMeetingVideoRequest(joinRequest());
      const payload = await response.json();
      assertEquals(response.status, 425);
      assertEquals(payload.code, "MEETING_NOT_OPEN_YET");
      assertEquals(
        payload.error,
        "The secure meeting room opens 15 minutes before the scheduled start time.",
      );
      assertEquals(authCalls, 1);
      assertEquals(authorizationCalls, 1);
      assertEquals(dailyCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

Deno.test("authorization denial returns the stable participant-safe contract", async () => {
  await withVideoEnvironment(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/auth/v1/user")) {
        return Response.json({ id: "84000000-0000-4000-8000-000000000001" });
      }
      if (url.includes("/rest/v1/rpc/authorize_matchmaking_video_action")) {
        return Response.json(
          { code: "42501", message: "Meeting not found or access denied" },
          { status: 403 },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    };
    try {
      const response = await handleMeetingVideoRequest(joinRequest());
      const payload = await response.json();
      assertEquals(response.status, 403);
      assertEquals(payload.code, "MEETING_UNAUTHORIZED");
      assertEquals(
        payload.error,
        "You are not authorized to join this meeting.",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
