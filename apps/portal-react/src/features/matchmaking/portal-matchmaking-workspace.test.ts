import { describe, expect, it } from "vitest";
import portal from "../../../../../portal.html?raw";
import matchmakingDomain from "../../../../../matchmaking-domain.js?raw";
import sharedNavigation from "../../../../../medichall-navigation.js?raw";
import standaloneMatchmaking from "../../../../../matchmaking.html?raw";
import standaloneWorkspace from "../../../../../matchmaking-workspace.js?raw";

type CalendarEvent = {
  ics: string;
  google: string;
  outlook: string;
  filename: string;
};

type MatchmakingUtils = {
  statusLabel: (value: unknown) => string;
  meetingStatusLabel: (
    meeting: Record<string, unknown>,
    currentProfileId: string,
  ) => string;
  meetingPermissions: (
    meeting: Record<string, unknown>,
    currentProfileId: string,
  ) => {
    role: string;
    canAccept: boolean;
    canCounter: boolean;
    canEdit: boolean;
    canWithdraw: boolean;
  };
  categorizeMeetings: (
    meetings: Array<Record<string, unknown>>,
    nowValue?: number,
  ) => {
    requests: Array<Record<string, unknown>>;
    upcoming: Array<Record<string, unknown>>;
    past: Array<Record<string, unknown>>;
  };
  badgeLabel: (value: number) => string;
  safeHttpUrl: (value: unknown) => string | null;
  dateTime: (value: unknown, timeZone: string) => string;
  relativeTime: (value: unknown, nowValue?: number) => string;
  groupNotifications: (
    notifications: Array<Record<string, unknown>>,
    nowValue?: number,
  ) => Array<{ label: string; items: Array<Record<string, unknown>> }>;
  proposalSlots: (
    values: Array<string | { date: string; time: string }>,
    durationMinutes: number,
    timeZone?: string,
  ) => Array<{ start_at: string; end_at: string }>;
  calendarEvent: (
    meeting: Record<string, unknown>,
    origin: string,
    entryPath?: string,
  ) => CalendarEvent | null;
};

const createUtils = new Function(
  `${matchmakingDomain}
  return globalThis.MedicHallMatchmakingDomain;`,
) as () => MatchmakingUtils;
const utils = createUtils();

describe("production Matchmaking Workspace", () => {
  it("uses clear generic lifecycle labels instead of ambiguous pending text", () => {
    expect(utils.statusLabel("awaiting_response")).toBe("Awaiting response");
    expect(utils.statusLabel("counter_proposed")).toBe("New time proposal");
    expect(utils.statusLabel("accepted")).toBe("Accepted");
    expect(utils.statusLabel("confirmed")).toBe("Confirmed");
  });

  it("renders role-aware requester and responder states with different actions", () => {
    const meeting = {
      status: "proposed",
      proposal_round: 1,
      requester_profile_id: "requester",
      recipient_profile_id: "recipient",
      proposals: [{
        proposal_round: 1,
        status: "active",
        proposed_by_profile_id: "requester",
      }],
    };

    expect(utils.meetingStatusLabel(meeting, "requester")).toBe(
      "Awaiting response",
    );
    expect(utils.meetingStatusLabel(meeting, "recipient")).toBe(
      "Action required",
    );
    expect(utils.meetingPermissions(meeting, "requester")).toMatchObject({
      canAccept: false,
      canEdit: true,
      canWithdraw: true,
    });
    expect(utils.meetingPermissions(meeting, "recipient")).toMatchObject({
      canAccept: true,
      canCounter: true,
      canEdit: false,
    });
  });

  it("creates exactly three timezone-aware UTC slots with a fixed duration", () => {
    const slots = utils.proposalSlots(
      [
        { date: "2035-01-01", time: "10:00" },
        { date: "2035-01-02", time: "14:30" },
        { date: "2035-01-03", time: "09:15" },
      ],
      45,
      "Europe/Istanbul",
    );
    expect(slots).toHaveLength(3);
    expect(
      Date.parse(slots[0].end_at) - Date.parse(slots[0].start_at),
    ).toBe(45 * 60 * 1000);
    expect(() => utils.proposalSlots([], 30)).toThrow();
    expect(() =>
      utils.proposalSlots(
        [
          "2035-01-01T10:00",
          "2035-01-01T10:00",
          "2035-01-01T10:00",
        ],
        30,
      )
    ).toThrow();
  });

  it("separates request, upcoming, and past meeting queues", () => {
    const groups = utils.categorizeMeetings([
      { id: 1, status: "proposed" },
      {
        id: 2,
        status: "confirmed",
        confirmed_end: "2035-01-01T10:30:00.000Z",
      },
      { id: 3, status: "declined" },
    ], Date.parse("2034-01-01T00:00:00.000Z"));

    expect(groups.requests.map((meeting) => meeting.id)).toEqual([1]);
    expect(groups.upcoming.map((meeting) => meeting.id)).toEqual([2]);
    expect(groups.past.map((meeting) => meeting.id)).toEqual([3]);
  });

  it("formats global notification badges without duplicate or oversized text", () => {
    expect(utils.badgeLabel(0)).toBe("");
    expect(utils.badgeLabel(9)).toBe("9");
    expect(utils.badgeLabel(10)).toBe("9+");
    expect(utils.badgeLabel(99)).toBe("9+");
    expect(utils.badgeLabel(100)).toBe("99+");
  });

  it("groups notifications and formats concise relative timestamps", () => {
    const now = Date.parse("2030-08-02T12:00:00.000Z");
    expect(utils.relativeTime("2030-08-02T11:55:00.000Z", now)).toBe("5m ago");
    expect(utils.relativeTime("2030-08-02T09:00:00.000Z", now)).toBe("3h ago");
    const groups = utils.groupNotifications([
      { id: 1, created_at: "2030-08-02T11:55:00.000Z" },
      { id: 2, created_at: "2030-08-01T18:00:00.000Z" },
      { id: 3, created_at: "2030-07-20T18:00:00.000Z" },
    ], now);
    expect(groups.map((group) => group.label)).toEqual(["Today", "Yesterday", "Older"]);
    expect(groups.flatMap((group) => group.items).map((item) => item.id)).toEqual([1, 2, 3]);
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
    expect(portal).toContain("Video meetings are not configured yet.");
    expect(portal).toContain("Meeting Details");
  });

  it("preserves the portal lifecycle without importing standalone presentation", () => {
    expect(portal).toContain('"Requests"');
    expect(portal).toContain('"Upcoming Meetings"');
    expect(portal).toContain('"Past Meetings"');
    expect(portal).toContain('<medichall-header mode="portal"');
    expect(sharedNavigation).toContain('id="portalNotificationBell"');
    expect(portal).toContain("get_portal_notification_center");
    expect(portal).toContain("mark_portal_notifications_read");
    expect(portal).toContain('id="mm-meeting-timezone"');
    expect(portal).toContain("revise_matchmaking_meeting_proposal");
    expect(portal).toContain("reschedule_matchmaking_meeting");
    expect(portal).toContain(
      '<script src="matchmaking-domain.js?v=20260808s2auth3"></script>',
    );
    expect(portal).not.toContain('src="matchmaking-workspace.js');
  });

  it("keeps a distinct standalone presentation with a complete lifecycle", () => {
    expect(standaloneMatchmaking).toContain("Find the right medical business partner.");
    expect(standaloneMatchmaking).toContain('id="workspaceTabs"');
    expect(standaloneMatchmaking).toContain('id="schedulerModal"');
    expect(standaloneMatchmaking).toContain('<medichall-header mode="matchmaking"');
    expect(sharedNavigation).toContain('id="notificationBell"');
    expect(standaloneMatchmaking).toContain('id="meetingDate"');
    expect(standaloneMatchmaking).toContain('id="timeChoices"');
    expect(standaloneMatchmaking).toContain('id="selectedSlots"');
    expect(standaloneMatchmaking).toContain("Review request");
    expect(standaloneMatchmaking).toContain("Meeting request sent");
    expect(standaloneMatchmaking).toContain(
      '<script src="matchmaking-workspace.js?v=20260808s2auth3"></script>',
    );
    expect(standaloneMatchmaking).not.toContain("document.write");
    expect(standaloneMatchmaking).not.toContain("SUPABASE_ANON_KEY");
    expect(standaloneMatchmaking).not.toContain("matchmaking_meeting_requests");

    expect(standaloneWorkspace).toContain('"Requests"');
    expect(standaloneWorkspace).toContain('"Upcoming Meetings"');
    expect(standaloneWorkspace).toContain('"Past Meetings"');
    expect(standaloneWorkspace).toContain("request_business_connection_v2");
    expect(standaloneWorkspace).toContain("propose_matchmaking_meeting");
    expect(standaloneWorkspace).toContain("revise_matchmaking_meeting_proposal");
    expect(standaloneWorkspace).toContain("reschedule_matchmaking_meeting");
    expect(standaloneWorkspace).toContain("get_portal_notification_center");
    expect(standaloneWorkspace).toContain("mark_portal_notifications_read");
    expect(standaloneWorkspace).toContain("Video meetings are not configured yet.");
    expect(standaloneWorkspace).toContain("Post-meeting outcome");
    expect(standaloneWorkspace).toContain("Immutable timeline");
  });

  it("removes every reachable legacy prompt-based meeting path", () => {
    const productionMatchmaking =
      `${portal}\n${standaloneMatchmaking}\n${standaloneWorkspace}`;
    expect(productionMatchmaking).not.toContain(
      "Meeting start (YYYY-MM-DDTHH:MM)",
    );
    expect(standaloneMatchmaking).not.toMatch(/\b(?:window\.)?prompt\s*\(/);
    expect(standaloneWorkspace).not.toMatch(/\b(?:window\.)?prompt\s*\(/);
  });

  it("includes keyboard focus management and accessible status announcements", () => {
    expect(portal).toContain('role="status" aria-live="polite"');
    expect(portal).toContain("function mmTrapModalFocus");
    expect(portal).toContain('if(event.key!=="Tab")return;');
    expect(portal).toContain("prefers-reduced-motion:reduce");
    expect(portal).toContain(":focus-visible");
    expect(standaloneMatchmaking).toContain('role="status" aria-live="polite"');
    expect(standaloneWorkspace).toContain("function trapFocus");
  });

  it("does not persist provider join tokens or include privileged secrets", () => {
    expect(portal).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(portal).not.toContain("DAILY_API_KEY");
    expect(portal).not.toMatch(/localStorage\.setItem\([^)]*result\.token/i);
    expect(portal).not.toContain('localStorage.setItem("mm_video');
    expect(portal).toContain('frame.src="about:blank"');
    expect(standaloneMatchmaking).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(standaloneWorkspace).not.toContain("DAILY_API_KEY");
    expect(standaloneWorkspace).not.toMatch(
      /localStorage\.setItem\([^)]*result\.token/i,
    );
    expect(standaloneWorkspace).toContain(
      'document.getElementById("videoFrame").src="about:blank"',
    );
  });
});
