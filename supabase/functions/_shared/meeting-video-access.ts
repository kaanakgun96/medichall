export const MEETING_VIDEO_JOIN_EARLY_MINUTES = 15;
export const MEETING_VIDEO_JOIN_GRACE_MINUTES = 60;

export type MeetingVideoJoinContext = {
  can_join?: unknown;
  status?: unknown;
  video_status?: unknown;
  start_at?: unknown;
  end_at?: unknown;
};

export type MeetingVideoJoinDenial = {
  status: 403 | 409 | 410 | 425;
  code:
    | "MEETING_UNAUTHORIZED"
    | "MEETING_NOT_OPEN_YET"
    | "MEETING_CANCELLED"
    | "MEETING_NO_LONGER_JOINABLE";
  error: string;
  join_opens_at?: string;
};

function timestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function classifyMeetingVideoJoinDenial(
  context: MeetingVideoJoinContext,
  serverNow = Date.now(),
): MeetingVideoJoinDenial | null {
  if (context.can_join === true) return null;

  const status = typeof context.status === "string"
    ? context.status.toLowerCase()
    : "";
  if (status === "cancelled") {
    return {
      status: 410,
      code: "MEETING_CANCELLED",
      error: "This meeting has been cancelled.",
    };
  }
  if (status !== "confirmed") {
    return {
      status: 410,
      code: "MEETING_NO_LONGER_JOINABLE",
      error: "This meeting is no longer available to join.",
    };
  }

  const startAt = timestamp(context.start_at);
  const endAt = timestamp(context.end_at);
  const joinOpensAt = startAt == null
    ? null
    : startAt - MEETING_VIDEO_JOIN_EARLY_MINUTES * 60_000;
  const joinClosesAt = endAt == null
    ? null
    : endAt + MEETING_VIDEO_JOIN_GRACE_MINUTES * 60_000;

  if (
    context.video_status === "ready" &&
    joinOpensAt != null &&
    Number.isFinite(serverNow) &&
    serverNow < joinOpensAt
  ) {
    return {
      status: 425,
      code: "MEETING_NOT_OPEN_YET",
      error:
        "The secure meeting room opens 15 minutes before the scheduled start time.",
      join_opens_at: new Date(joinOpensAt).toISOString(),
    };
  }

  if (
    joinClosesAt != null &&
    Number.isFinite(serverNow) &&
    serverNow > joinClosesAt
  ) {
    return {
      status: 410,
      code: "MEETING_NO_LONGER_JOINABLE",
      error: "This meeting is no longer available to join.",
    };
  }

  return {
    status: 409,
    code: "MEETING_NO_LONGER_JOINABLE",
    error: "This meeting is no longer available to join.",
  };
}
