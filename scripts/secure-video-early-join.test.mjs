import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const domainSource = read("matchmaking-domain.js");
const portal = read("portal.html");
const standalone = read("matchmaking-workspace.js");
const edge = read("supabase/functions/meeting-video/index.ts");

const sandbox = { Date, Intl, URL, TextEncoder };
sandbox.globalThis = sandbox;
vm.runInNewContext(domainSource, sandbox, { filename: "matchmaking-domain.js" });
const utils = sandbox.MedicHallMatchmakingDomain;
const start = Date.parse("2026-08-14T06:30:00.000Z"); // 09:30 Europe/Istanbul
const meeting = {
  id: 42,
  status: "confirmed",
  video_status: "ready",
  confirmed_start: new Date(start).toISOString(),
  confirmed_end: new Date(start + 30 * 60_000).toISOString(),
  timezone: "Europe/Istanbul",
};

test("join stays disabled before 09:15 and enables exactly at the boundary", () => {
  for (const now of [start - 16 * 60_000, start - 15 * 60_000 - 1_000]) {
    assert.equal(utils.videoJoinState(meeting, now).joinable, false);
    assert.equal(utils.videoJoinState(meeting, now).state, "scheduled");
  }
  for (const now of [start - 15 * 60_000, start - 10 * 60_000, start - 60_000, start]) {
    assert.equal(utils.videoJoinState(meeting, now).joinable, true);
    assert.equal(utils.videoJoinState(meeting, now).state, "ready");
  }
});

test("opening label uses the meeting timezone rather than browser timezone", () => {
  const label = utils.videoJoinOpeningLabel(meeting, start - 16 * 60_000);
  assert.match(label, /(?:09:15|9:15\s*AM)/i);
  assert.match(label, /Europe\/Istanbul/);
  assert.equal(utils.videoJoinState({ ...meeting, timezone: "Not/AZone" }, start).timeZone, "UTC");
});

test("video response states map to explicit safe messages", () => {
  assert.equal(utils.videoJoinErrorMessage({ code: "MEETING_NOT_OPEN_YET", status: 425 }), "The secure meeting room opens 15 minutes before the scheduled start time.");
  assert.equal(utils.videoJoinErrorMessage({ code: "MEETING_UNAUTHORIZED", status: 403 }), "You are not authorized to join this meeting.");
  assert.equal(utils.videoJoinErrorMessage({ code: "MEETING_CANCELLED", status: 410 }), "This meeting has been cancelled.");
  assert.equal(utils.videoJoinErrorMessage({ code: "MEETING_NO_LONGER_JOINABLE", status: 410 }), "This meeting is no longer available to join.");
  assert.equal(utils.videoJoinErrorMessage({ code: "HTTP_409", status: 409 }), "This record was updated elsewhere. Refresh and try again.");
  assert.equal(utils.videoJoinErrorMessage({ code: "HTTP_502", status: 502 }), "We couldn't open the secure meeting room. Please try again.");
});

test("clients auto-enable locally and coalesce duplicate join requests", () => {
  assert.equal(utils.nextVideoJoinDelay([meeting], start - 16 * 60_000), 60_000);
  for (const source of [portal, standalone]) {
    assert.match(source, /setTimeout\(refresh(?:Mm)?VideoJoinControls,Math\.min\(delay\+50,2147483647\)\)/);
    assert.match(source, /UI\.singleFlight\("meeting-video:join:"\+Number\(meetingId\),run\)/);
    assert.doesNotMatch(source, /setInterval\([^\n]*meeting-video/);
    assert.doesNotMatch(source, /join_window_closed/);
  }
});

test("Edge uses the explicit early contract and retains server authorization", () => {
  assert.match(edge, /classifyMeetingVideoJoinDenial\(context\)/);
  assert.match(edge, /context\.can_join !== true/);
  assert.doesNotMatch(edge, /join_window_closed/);
});
