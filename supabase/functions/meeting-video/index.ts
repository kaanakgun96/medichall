/// <reference path="../_shared/edge-runtime.d.ts" />

// deno-lint-ignore no-import-prefix -- Edge bundle pins the production client.
import { createClient } from "npm:@supabase/supabase-js@2.110.8";
import {
  createMeetingVideoProvider,
  readMeetingVideoConfig,
  VIDEO_PROVIDER_CONFIGURATION,
  VideoProviderError,
  type VideoRoomClaim,
} from "../_shared/meeting-video-provider.ts";
import { classifyMeetingVideoJoinDenial } from "../_shared/meeting-video-access.ts";

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
      "Cache-Control": "no-store, private",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function configurationStatus() {
  return {
    enabled: false,
    provider: "daily",
    required_edge_secrets: [
      VIDEO_PROVIDER_CONFIGURATION.providerVariable,
      VIDEO_PROVIDER_CONFIGURATION.dailyApiKeyVariable,
    ],
    optional_edge_secrets: [
      VIDEO_PROVIDER_CONFIGURATION.dailyApiBaseUrlVariable,
    ],
  };
}

export async function handleMeetingVideoRequest(
  req: Request,
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(req),
    });
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
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(
      req,
      { error: "Meeting video backend is not configured." },
      500,
    );
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
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
  const action = text(payload.action);
  const meetingId = positiveInteger(payload.meeting_id);
  if (!["prepare", "join", "revoke"].includes(action) || !meetingId) {
    return json(req, {
      error: "A valid meeting_id and video action are required.",
    }, 400);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: contextData, error: contextError } = await userClient.rpc(
    "authorize_matchmaking_video_action",
    { p_meeting_id: meetingId, p_action: action },
  );
  if (contextError) {
    const rateLimited = contextError.message.toLowerCase().includes(
      "too many video requests",
    );
    const joinDenied = action === "join" && !rateLimited;
    return json(req, {
      error: rateLimited
        ? "Too many video requests. Try again in a few minutes."
        : joinDenied
        ? "You are not authorized to join this meeting."
        : "Meeting not found or access denied.",
      code: rateLimited
        ? "MEETING_RATE_LIMITED"
        : joinDenied
        ? "MEETING_UNAUTHORIZED"
        : undefined,
    }, rateLimited ? 429 : 403);
  }
  const context = record(contextData);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let config;
  try {
    config = readMeetingVideoConfig((name) => Deno.env.get(name));
  } catch {
    return json(req, {
      error: "Meeting video configuration is invalid.",
      code: "video_provider_unconfigured",
      configuration: configurationStatus(),
    }, 503);
  }

  if (action === "prepare") {
    if (!["accepted", "confirmed"].includes(text(context.status))) {
      return json(req, {
        error: "The meeting must be accepted before video is prepared.",
      }, 409);
    }
    const { data: claimData, error: claimError } = await adminClient.rpc(
      "claim_matchmaking_video_room",
      { p_meeting_id: meetingId },
    );
    if (claimError) {
      return json(req, { error: "The video room could not be claimed." }, 409);
    }
    const claim = record(claimData);
    if (claim.claim_granted !== true) {
      const currentStatus = text(claim.video_status);
      return json(req, {
        meeting_id: meetingId,
        status: currentStatus === "creating" ? "preparing" : "confirmed",
        video_status: currentStatus,
        configuration: currentStatus === "unconfigured"
          ? configurationStatus()
          : undefined,
      }, currentStatus === "creating" ? 202 : 200);
    }

    if (!config.enabled) {
      const { error: completeError } = await adminClient.rpc(
        "complete_matchmaking_video_room",
        {
          p_meeting_id: meetingId,
          p_provider: "disabled",
          p_video_status: "unconfigured",
          p_room_name: text(claim.room_name),
          p_room_url: null,
          p_room_expires_at: claim.room_expires_at,
        },
      );
      if (completeError) {
        return json(req, {
          error: "The accepted meeting could not be confirmed.",
        }, 500);
      }
      return json(req, {
        meeting_id: meetingId,
        status: "confirmed",
        video_status: "unconfigured",
        configuration: configurationStatus(),
      });
    }

    try {
      const provider = createMeetingVideoProvider(config);
      const roomClaim: VideoRoomClaim = {
        meetingId,
        roomName: text(claim.room_name),
        startAt: text(claim.start_at),
        endAt: text(claim.end_at),
        roomNotBefore: text(claim.room_not_before),
        roomExpiresAt: text(claim.room_expires_at),
        maxParticipants: positiveInteger(claim.max_participants) ?? 2,
      };
      const room = await provider.createRoom(roomClaim);
      const { error: completeError } = await adminClient.rpc(
        "complete_matchmaking_video_room",
        {
          p_meeting_id: meetingId,
          p_provider: room.provider,
          p_video_status: "ready",
          p_room_name: room.roomName,
          p_room_url: room.roomUrl,
          p_room_expires_at: room.expiresAt,
        },
      );
      if (completeError) {
        await provider.revokeRoom(room.roomName).catch(() => undefined);
        return json(req, {
          error: "The secure room was not attached to the meeting.",
        }, 500);
      }
      return json(req, {
        meeting_id: meetingId,
        status: "confirmed",
        video_status: "ready",
        provider: room.provider,
      });
    } catch (error) {
      const safeCode = error instanceof VideoProviderError
        ? error.safeCode
        : "provider_request_failed";
      await adminClient.rpc("fail_matchmaking_video_room", {
        p_meeting_id: meetingId,
        p_error_code: safeCode,
      });
      return json(req, {
        error: "The secure video room could not be prepared. Try again.",
        code: safeCode,
      }, 502);
    }
  }

  if (action === "join") {
    if (context.video_status === "unconfigured" || !config.enabled) {
      return json(req, {
        error: "Meeting video is not configured.",
        code: "video_provider_unconfigured",
        configuration: configurationStatus(),
      }, 503);
    }
    if (context.can_join !== true) {
      const denial = classifyMeetingVideoJoinDenial(context);
      return json(req, {
        error: denial?.error ?? "This meeting is no longer available to join.",
        code: denial?.code ?? "MEETING_NO_LONGER_JOINABLE",
        join_opens_at: denial?.join_opens_at,
      }, denial?.status ?? 409);
    }

    try {
      const provider = createMeetingVideoProvider(config);
      const join = await provider.createJoinToken({
        roomName: text(context.room_name),
        roomUrl: text(context.room_url),
        participantName: text(context.participant_name),
        participantProfileId: text(context.participant_profile_id),
        roomExpiresAt: text(context.room_expires_at),
      });
      return json(req, {
        meeting_id: meetingId,
        provider: join.provider,
        room_url: join.roomUrl,
        token: join.token,
        expires_at: join.expiresAt,
      });
    } catch (error) {
      const safeCode = error instanceof VideoProviderError
        ? error.safeCode
        : "provider_request_failed";
      return json(req, {
        error: "A secure join token could not be created.",
        code: safeCode,
      }, 502);
    }
  }

  if (context.can_revoke !== true) {
    return json(req, {
      error: "Cancel the meeting before revoking its video room.",
    }, 409);
  }
  const roomName = text(context.room_name);
  if (roomName && context.video_provider === "daily") {
    if (!config.enabled) {
      return json(req, {
        error:
          "The room is access-blocked in MedicHall but provider revocation requires DAILY_API_KEY.",
        code: "provider_revocation_unconfigured",
        configuration: configurationStatus(),
      }, 503);
    }
    try {
      await createMeetingVideoProvider(config).revokeRoom(roomName);
    } catch {
      return json(req, {
        error: "The provider room could not be revoked. Try again.",
        code: "provider_request_failed",
      }, 502);
    }
  }
  const { error: revokeError } = await adminClient.rpc(
    "record_matchmaking_video_revocation",
    { p_meeting_id: meetingId },
  );
  if (revokeError) {
    return json(req, { error: "Video revocation could not be recorded." }, 500);
  }
  return json(req, {
    meeting_id: meetingId,
    status: "cancelled",
    video_status: "revoked",
  });
}

if (import.meta.main) Deno.serve(handleMeetingVideoRequest);
