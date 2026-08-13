import {
  classifyMeetingVideoJoinDenial,
  MEETING_VIDEO_JOIN_EARLY_MINUTES,
} from "./meeting-video-access.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`Expected ${right}, received ${left}`);
}

const start = Date.parse("2026-08-14T06:30:00.000Z"); // 09:30 Europe/Istanbul
const context = {
  can_join: false,
  status: "confirmed",
  video_status: "ready",
  start_at: new Date(start).toISOString(),
  end_at: new Date(start + 30 * 60_000).toISOString(),
};

Deno.test("server early-join boundary is explicit until exactly 15 minutes before start", () => {
  assertEquals(MEETING_VIDEO_JOIN_EARLY_MINUTES, 15);
  for (const offset of [16 * 60_000, 15 * 60_000 + 1_000]) {
    const denial = classifyMeetingVideoJoinDenial(context, start - offset);
    assertEquals(denial?.status, 425);
    assertEquals(denial?.code, "MEETING_NOT_OPEN_YET");
    assertEquals(denial?.join_opens_at, "2026-08-14T06:15:00.000Z");
  }
});

Deno.test("database authorization remains authoritative at and inside the window", () => {
  for (const now of [start - 15 * 60_000, start - 10 * 60_000, start]) {
    assertEquals(
      classifyMeetingVideoJoinDenial({ ...context, can_join: true }, now),
      null,
    );
    assertEquals(
      classifyMeetingVideoJoinDenial({ ...context, can_join: false }, now)
        ?.code,
      "MEETING_NO_LONGER_JOINABLE",
    );
  }
});

Deno.test("cancelled and ended meetings remain distinct from early join", () => {
  assertEquals(
    classifyMeetingVideoJoinDenial({ ...context, status: "cancelled" }, start)
      ?.code,
    "MEETING_CANCELLED",
  );
  assertEquals(
    classifyMeetingVideoJoinDenial(
      context,
      start + 30 * 60_000 + 60 * 60_000 + 1,
    )?.code,
    "MEETING_NO_LONGER_JOINABLE",
  );
});
