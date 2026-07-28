import { describe, expect, it } from "vitest";
import portal from "../../../../../portal.html?raw";

type CalendarEvent = {
  ics: string;
  google: string;
  outlook: string;
  filename: string;
};

type MatchmakingUtils = {
  statusLabel: (value: unknown) => string;
  safeHttpUrl: (value: unknown) => string | null;
  dateTime: (value: unknown, timeZone: string) => string;
  proposalSlots: (
    values: string[],
    durationMinutes: number,
  ) => Array<{ start_at: string; end_at: string }>;
  calendarEvent: (
    meeting: Record<string, unknown>,
    origin: string,
  ) => CalendarEvent | null;
};

function between(start: string, end: string) {
  const startIndex = portal.indexOf(start);
  const endIndex = portal.indexOf(end);
  if (startIndex < 0 || endIndex <= startIndex) {
    throw new Error(`Missing portal test markers: ${start} / ${end}`);
  }
  return portal.slice(startIndex + start.length, endIndex);
}

const utilitySource = between(
  "/* MATCHMAKING_WORKSPACE_UTILS_START */",
  "/* MATCHMAKING_WORKSPACE_UTILS_END */",
);
const createUtils = new Function(
  `${utilitySource}
  return globalThis.MatchmakingUtils;`,
) as () => MatchmakingUtils;
const utils = createUtils();

describe("production Matchmaking Workspace", () => {
  it("uses clear lifecycle labels instead of ambiguous pending text", () => {
    expect(utils.statusLabel("awaiting_response")).toBe("Awaiting response");
    expect(utils.statusLabel("counter_proposed")).toBe("Counter-proposed");
    expect(utils.statusLabel("accepted")).toBe("Accepted — confirming");
    expect(utils.statusLabel("confirmed")).toBe("Confirmed");
  });

  it("creates one to three UTC proposal slots with a fixed duration", () => {
    const slots = utils.proposalSlots(
      [
        "2030-01-01T10:00",
        "2030-01-02T14:30",
        "2030-01-03T09:15",
      ],
      45,
    );
    expect(slots).toHaveLength(3);
    expect(
      Date.parse(slots[0].end_at) - Date.parse(slots[0].start_at),
    ).toBe(45 * 60 * 1000);
    expect(() => utils.proposalSlots([], 30)).toThrow();
    expect(() =>
      utils.proposalSlots(
        ["2030-01-01T10:00", "2030-01-01T10:00"],
        30,
      )
    ).toThrow();
  });

  it("generates a standards-shaped ICS event and safe calendar compose links", () => {
    const event = utils.calendarEvent({
      id: 72,
      title: "Portfolio, MDR & next steps",
      agenda: "Review product evidence\nAgree next steps",
      confirmed_start: "2030-01-01T10:00:00.000Z",
      confirmed_end: "2030-01-01T10:30:00.000Z",
      video_join_token: "must-never-enter-calendar-output",
    }, "https://medichall.com");

    expect(event?.ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(event?.ics).toContain("BEGIN:VEVENT\r\n");
    expect(event?.ics).toContain("SUMMARY:Portfolio\\, MDR & next steps");
    expect(event?.ics).toContain(
      "https://medichall.com/portal.html#matchmaking-meeting=72",
    );
    expect(event?.google).toMatch(/^https:\/\/calendar\.google\.com\//);
    expect(event?.outlook).toMatch(/^https:\/\/outlook\.live\.com\//);
    expect(event?.ics).not.toContain("must-never-enter-calendar-output");
  });

  it("renders the same UTC instant independently in participant timezones", () => {
    const instant = "2030-07-01T10:00:00.000Z";
    const istanbul = utils.dateTime(instant, "Europe/Istanbul");
    const berlin = utils.dateTime(instant, "Europe/Berlin");

    expect(istanbul).not.toBe("Time unavailable");
    expect(berlin).not.toBe("Time unavailable");
    expect(istanbul).not.toBe(berlin);
  });

  it("rejects unsafe external URL schemes", () => {
    expect(utils.safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(utils.safeHttpUrl("data:text/html,unsafe")).toBeNull();
    expect(utils.safeHttpUrl("https://partner.example/path")).toBe(
      "https://partner.example/path",
    );
  });

  it("contains authenticated video, calendar, timeline, and follow-up surfaces", () => {
    expect(portal).toContain('"/functions/v1/meeting-video"');
    expect(portal).toContain("joinMmVideo");
    expect(portal).toContain("Download ICS");
    expect(portal).toContain("Immutable timeline");
    expect(portal).toContain("Post-meeting outcome");
    expect(portal).toContain("Private meeting note");
    expect(portal).toContain("Recording is disabled");
    expect(portal).toContain("Meeting time accepted. Video confirmation needs a retry.");
  });

  it("includes keyboard focus management and accessible status announcements", () => {
    expect(portal).toContain('role="status" aria-live="polite"');
    expect(portal).toContain("function mmTrapModalFocus");
    expect(portal).toContain('if(event.key!=="Tab")return;');
    expect(portal).toContain("prefers-reduced-motion:reduce");
    expect(portal).toContain(":focus-visible");
  });

  it("does not persist provider join tokens or include privileged secrets", () => {
    expect(portal).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(portal).not.toContain("DAILY_API_KEY");
    expect(portal).not.toMatch(/localStorage\.setItem\([^)]*result\.token/i);
    expect(portal).not.toContain('localStorage.setItem("mm_video');
    expect(portal).toContain('frame.src="about:blank"');
  });
});
