import {
  buildDailyJoinTokenRequest,
  buildDailyRoomRequest,
  createMeetingVideoProvider,
  readMeetingVideoConfig,
  VIDEO_PROVIDER_CONFIGURATION,
  VideoProviderError,
  type VideoRoomClaim,
} from "./meeting-video-provider.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message: string) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`);
  }
}

const claim: VideoRoomClaim = {
  meetingId: 42,
  roomName: "mh-42-safe",
  startAt: "2026-08-01T09:00:00.000Z",
  endAt: "2026-08-01T09:30:00.000Z",
  roomNotBefore: "2026-08-01T08:45:00.000Z",
  roomExpiresAt: "2026-08-01T10:30:00.000Z",
  maxParticipants: 2,
};

Deno.test("video configuration is truthfully disabled without a Daily key", () => {
  const config = readMeetingVideoConfig((name) => {
    if (name === VIDEO_PROVIDER_CONFIGURATION.providerVariable) return "daily";
    return undefined;
  });
  assertEquals(config.enabled, false, "configuration should be disabled");
  assertEquals(
    config.disabledReason,
    "missing_daily_api_key",
    "missing-key reason should be explicit",
  );
  let error: unknown;
  try {
    createMeetingVideoProvider(config);
  } catch (caught) {
    error = caught;
  }
  assert(
    error instanceof VideoProviderError &&
      error.safeCode === "provider_unconfigured",
    "provider creation should fail with a safe configuration error",
  );
});

Deno.test("Daily rooms are private, expiring, and do not enable recording", () => {
  const body = buildDailyRoomRequest(claim);
  assertEquals(body.privacy, "private", "room must be private");
  assertEquals(
    body.properties.enable_screenshare,
    true,
    "screen sharing should be available",
  );
  assertEquals(
    body.properties.enable_chat,
    false,
    "relationship chat stays in MedicHall",
  );
  assertEquals(
    body.properties.eject_at_room_exp,
    true,
    "room expiry should eject participants",
  );
  assert(
    !Object.keys(body.properties).some((key) =>
      key.toLowerCase().includes("record")
    ),
    "room request must not opt into recording",
  );
});

Deno.test("Daily join tokens are room-scoped and short-lived", () => {
  const now = new Date("2026-08-01T08:50:00.000Z");
  const result = buildDailyJoinTokenRequest({
    roomName: claim.roomName,
    roomUrl: "https://medichall.daily.co/mh-42-safe",
    participantName: "Partner User",
    participantProfileId: "5949844f-e501-4f51-a894-4f2799b161c0",
    roomExpiresAt: claim.roomExpiresAt,
  }, now);
  assertEquals(
    result.properties.room_name,
    claim.roomName,
    "token should be scoped to one room",
  );
  assertEquals(
    result.properties.enable_recording_ui,
    false,
    "recording controls should stay disabled",
  );
  assertEquals(
    result.expiresAt,
    "2026-08-01T09:50:00.000Z",
    "token lifetime should be capped at one hour",
  );
});

Deno.test("Daily provider keeps its API key in authorization headers only", async () => {
  const activeClaim: VideoRoomClaim = {
    ...claim,
    roomNotBefore: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    roomExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const mockFetch = (
    input: string | URL | Request,
    init: RequestInit = {},
  ): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/rooms")) {
      return Promise.resolve(Response.json({
        name: claim.roomName,
        url: "https://medichall.daily.co/mh-42-safe",
      }, { status: 201 }));
    }
    if (url.endsWith("/meeting-tokens")) {
      return Promise.resolve(Response.json({ token: "short-lived-token" }));
    }
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  const provider = createMeetingVideoProvider({
    provider: "daily",
    enabled: true,
    dailyApiKey: "test-provider-secret",
    dailyApiBaseUrl: "https://api.daily.co/v1",
  }, mockFetch);

  const room = await provider.createRoom(activeClaim);
  await provider.createJoinToken({
    roomName: room.roomName,
    roomUrl: room.roomUrl,
    participantName: "Partner User",
    participantProfileId: "5949844f-e501-4f51-a894-4f2799b161c0",
    roomExpiresAt: room.expiresAt,
  });
  await provider.revokeRoom(room.roomName);

  assertEquals(calls.length, 3, "provider should make three requests");
  for (const call of calls) {
    const headers = new Headers(call.init.headers);
    assertEquals(
      headers.get("authorization"),
      "Bearer test-provider-secret",
      "provider key should be in the authorization header",
    );
    assert(
      !String(call.init.body ?? "").includes("test-provider-secret"),
      "provider key must not appear in request bodies",
    );
  }
});
