export const VIDEO_PROVIDER_CONFIGURATION = Object.freeze({
  providerVariable: "MEETING_VIDEO_PROVIDER",
  dailyApiKeyVariable: "DAILY_API_KEY",
  dailyApiBaseUrlVariable: "DAILY_API_BASE_URL",
  defaultDailyApiBaseUrl: "https://api.daily.co/v1",
});

export type VideoProviderName = "daily" | "disabled";

export type MeetingVideoConfig = {
  provider: VideoProviderName;
  enabled: boolean;
  dailyApiKey?: string;
  dailyApiBaseUrl: string;
  disabledReason?: "provider_disabled" | "missing_daily_api_key";
};

export type VideoRoomClaim = {
  meetingId: number;
  roomName: string;
  startAt: string;
  endAt: string;
  roomNotBefore: string;
  roomExpiresAt: string;
  maxParticipants: number;
};

export type CreatedVideoRoom = {
  provider: "daily";
  roomName: string;
  roomUrl: string;
  expiresAt: string;
};

export type JoinTokenRequest = {
  roomName: string;
  roomUrl: string;
  participantName: string;
  participantProfileId: string;
  roomExpiresAt: string;
};

export type CreatedJoinToken = {
  provider: "daily";
  roomUrl: string;
  token: string;
  expiresAt: string;
};

export interface MeetingVideoProvider {
  readonly name: VideoProviderName;
  createRoom(claim: VideoRoomClaim): Promise<CreatedVideoRoom>;
  createJoinToken(request: JoinTokenRequest): Promise<CreatedJoinToken>;
  revokeRoom(roomName: string): Promise<void>;
}

export class VideoProviderError extends Error {
  constructor(
    message: string,
    readonly safeCode:
      | "provider_unconfigured"
      | "provider_request_failed"
      | "provider_invalid_response",
  ) {
    super(message);
    this.name = "VideoProviderError";
  }
}

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function cleanBaseUrl(value: string | undefined): string {
  const candidate =
    (value ?? VIDEO_PROVIDER_CONFIGURATION.defaultDailyApiBaseUrl)
      .trim()
      .replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new VideoProviderError(
      "The Daily API base URL is invalid.",
      "provider_unconfigured",
    );
  }
  if (parsed.protocol !== "https:") {
    throw new VideoProviderError(
      "The Daily API base URL must use HTTPS.",
      "provider_unconfigured",
    );
  }
  return parsed.toString().replace(/\/+$/, "");
}

export function readMeetingVideoConfig(
  getEnv: (name: string) => string | undefined,
): MeetingVideoConfig {
  const requested = (getEnv(
    VIDEO_PROVIDER_CONFIGURATION.providerVariable,
  ) ?? "daily").trim().toLowerCase();
  if (requested !== "daily" && requested !== "disabled") {
    throw new VideoProviderError(
      "MEETING_VIDEO_PROVIDER must be daily or disabled.",
      "provider_unconfigured",
    );
  }

  const dailyApiBaseUrl = cleanBaseUrl(
    getEnv(VIDEO_PROVIDER_CONFIGURATION.dailyApiBaseUrlVariable),
  );
  if (requested === "disabled") {
    return {
      provider: "disabled",
      enabled: false,
      dailyApiBaseUrl,
      disabledReason: "provider_disabled",
    };
  }

  const dailyApiKey = getEnv(
    VIDEO_PROVIDER_CONFIGURATION.dailyApiKeyVariable,
  )?.trim();
  if (!dailyApiKey) {
    return {
      provider: "daily",
      enabled: false,
      dailyApiBaseUrl,
      disabledReason: "missing_daily_api_key",
    };
  }

  return {
    provider: "daily",
    enabled: true,
    dailyApiKey,
    dailyApiBaseUrl,
  };
}

function unixSeconds(value: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new VideoProviderError(
      "The meeting time is invalid.",
      "provider_invalid_response",
    );
  }
  return Math.floor(timestamp / 1000);
}

export function buildDailyRoomRequest(claim: VideoRoomClaim): {
  name: string;
  privacy: "private";
  properties: Record<string, unknown>;
} {
  return {
    name: claim.roomName,
    privacy: "private",
    properties: {
      nbf: unixSeconds(claim.roomNotBefore),
      exp: unixSeconds(claim.roomExpiresAt),
      eject_at_room_exp: true,
      max_participants: Math.max(2, Math.min(claim.maxParticipants, 10)),
      enable_prejoin_ui: true,
      enable_people_ui: true,
      enable_screenshare: true,
      enable_chat: false,
      enable_shared_chat_history: false,
      start_video_off: true,
      start_audio_off: true,
    },
  };
}

export function buildDailyJoinTokenRequest(
  request: JoinTokenRequest,
  now = new Date(),
): { properties: Record<string, unknown>; expiresAt: string } {
  const roomExpiryMs = Date.parse(request.roomExpiresAt);
  const tokenExpiryMs = Math.min(
    roomExpiryMs,
    now.getTime() + 60 * 60 * 1000,
  );
  if (!Number.isFinite(tokenExpiryMs) || tokenExpiryMs <= now.getTime()) {
    throw new VideoProviderError(
      "The secure room has expired.",
      "provider_invalid_response",
    );
  }
  const expiresAt = new Date(tokenExpiryMs).toISOString();
  return {
    properties: {
      room_name: request.roomName,
      user_name: request.participantName.slice(0, 120),
      user_id: request.participantProfileId,
      exp: Math.floor(tokenExpiryMs / 1000),
      eject_at_token_exp: true,
      is_owner: false,
      enable_recording_ui: false,
    },
    expiresAt,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export class DailyMeetingVideoProvider implements MeetingVideoProvider {
  readonly name = "daily" as const;

  constructor(
    private readonly config: MeetingVideoConfig,
    private readonly request: FetchLike = fetch,
  ) {
    if (!config.enabled || !config.dailyApiKey) {
      throw new VideoProviderError(
        "Daily video is not configured.",
        "provider_unconfigured",
      );
    }
  }

  private async dailyRequest(
    path: string,
    init: RequestInit,
    allowNotFound = false,
    allowedStatuses: number[] = [],
  ): Promise<Response> {
    const response = await this.request(
      `${this.config.dailyApiBaseUrl}${path}`,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${this.config.dailyApiKey}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
      },
    );
    if (
      !response.ok &&
      !(allowNotFound && response.status === 404) &&
      !allowedStatuses.includes(response.status)
    ) {
      throw new VideoProviderError(
        `Daily request failed with status ${response.status}.`,
        "provider_request_failed",
      );
    }
    return response;
  }

  async createRoom(claim: VideoRoomClaim): Promise<CreatedVideoRoom> {
    let response = await this.dailyRequest(
      "/rooms",
      {
        method: "POST",
        body: JSON.stringify(buildDailyRoomRequest(claim)),
      },
      false,
      [400, 409],
    );
    if (response.status === 400 || response.status === 409) {
      response = await this.dailyRequest(
        `/rooms/${encodeURIComponent(claim.roomName)}`,
        { method: "GET" },
      );
    }

    const body = record(await response.json());
    const roomName = typeof body.name === "string" ? body.name : "";
    const roomUrl = typeof body.url === "string" ? body.url : "";
    if (
      roomName !== claim.roomName ||
      !roomUrl.startsWith("https://")
    ) {
      throw new VideoProviderError(
        "Daily returned an invalid room.",
        "provider_invalid_response",
      );
    }

    return {
      provider: "daily",
      roomName,
      roomUrl,
      expiresAt: claim.roomExpiresAt,
    };
  }

  async createJoinToken(
    request: JoinTokenRequest,
  ): Promise<CreatedJoinToken> {
    const tokenRequest = buildDailyJoinTokenRequest(request);
    const response = await this.dailyRequest("/meeting-tokens", {
      method: "POST",
      body: JSON.stringify({ properties: tokenRequest.properties }),
    });
    const body = record(await response.json());
    const token = typeof body.token === "string" ? body.token : "";
    if (!token) {
      throw new VideoProviderError(
        "Daily returned an invalid meeting token.",
        "provider_invalid_response",
      );
    }
    return {
      provider: "daily",
      roomUrl: request.roomUrl,
      token,
      expiresAt: tokenRequest.expiresAt,
    };
  }

  async revokeRoom(roomName: string): Promise<void> {
    await this.dailyRequest(
      `/rooms/${encodeURIComponent(roomName)}`,
      { method: "DELETE" },
      true,
    );
  }
}

export function createMeetingVideoProvider(
  config: MeetingVideoConfig,
  request: FetchLike = fetch,
): MeetingVideoProvider {
  if (!config.enabled || config.provider === "disabled") {
    throw new VideoProviderError(
      "Meeting video is not configured.",
      "provider_unconfigured",
    );
  }
  return new DailyMeetingVideoProvider(config, request);
}
