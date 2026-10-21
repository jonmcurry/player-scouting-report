// Read-only presentation data derived from the publication-reviewed Emily fixture.
// Keep every coaching claim traceable to a verified checklist note, priority,
// observation, or player next-step in demo-export/public-2026-10-01/emily/fixture.json.

const REVIEW_DATE = "2026-09-19";
const PLAYER_NAME = "Emily";

const drill = {
  id: "load-and-pause",
  name: "Load-and-pause",
  bestFor: "Clean, repeatable load position.",
  equipment: "Tee or soft toss",
  homeFriendly: false,
  requiresScreen: false,
  instructions: "Load and hold a beat at the top before starting the swing. Check hands and weight are where you want them, then go.",
  cue: null,
  looksRightWhen: null,
  commonMistakes: [],
  demoUrl: null,
  demoTimestamp: null,
  sourceCredit: "Coach-assigned in Emily's reviewed demo record",
};

const athleticBase = "Athletic base with the feet set outside shoulder width and visible knee flex. (Coach-confirmed on 4 swings.)";

const clips = [
  {
    id: "emily-clip-004",
    entryId: "emily-at-bat-2",
    mediaPath: "emily-2026-09-26.1-clip-004.mp4",
    contactTime: 5.2894,
    headline: "Four-swing review complete",
    summary: "This game swing is part of Emily's coach-reviewed four-swing set. No separate coaching correction was verified for this clip.",
    strengths: [athleticBase],
    fix: null,
  },
  {
    id: "emily-clip-003",
    entryId: "emily-at-bat-2",
    mediaPath: "emily-2026-09-26.1-clip-003.mp4",
    contactTime: 4.7203,
    headline: "Athletic setup and contact out front",
    summary: "Emily started from an athletic base and met the ball out in front. Her repeatable load is the current development focus.",
    strengths: [
      athleticBase,
      "At contact the ball meets the barrel out in front of her body and her arms are extending.",
    ],
    fix: {
      id: "demo-load-focus",
      issue: "Same load, every pitch",
      evidence: "Developing. The coach's current Priority is one repeatable load on every pitch.",
      coachingCue: "Build one repeatable load: hands back, weight back, then go. The goal is the same load on every pitch, not a bigger one.",
      lookForNext: "Capture another swing with the full body and bat visible through contact.",
    },
  },
  {
    id: "emily-clip-002",
    entryId: "emily-at-bat-2",
    mediaPath: "emily-2026-09-26.1-clip-002.mp4",
    contactTime: 4.7537,
    headline: "Athletic base held across the set",
    summary: "This game swing is part of the four-swing set used to confirm Emily's athletic starting position. No separate correction was verified for this clip.",
    strengths: [athleticBase],
    fix: null,
  },
  {
    id: "emily-clip-001",
    entryId: "emily-at-bat-1",
    mediaPath: "emily-2026-09-26.1-clip-001.mp4",
    contactTime: 4.2851,
    headline: "Strong extension through contact",
    summary: "Emily extended both arms out in front, with the barrel continuing toward the pitcher instead of wrapping early.",
    strengths: [
      athleticBase,
      "Both arms are clearly extended out in front of the body, with the barrel continuing toward the pitcher instead of wrapping early.",
    ],
    fix: null,
  },
];

function mediaUrl(basePath, mediaPath) {
  return new URL(`${basePath}media/${encodeURIComponent(mediaPath)}`, location.origin).href;
}

function reportFor(clip, playerId, basePath) {
  return {
    playerId,
    playerName: PLAYER_NAME,
    status: "ready",
    entryId: clip.entryId,
    entryClipIds: clips.filter((item) => item.entryId === clip.entryId).map((item) => item.id),
    mediaPath: clip.mediaPath,
    videoUrl: mediaUrl(basePath, clip.mediaPath),
    contactTime: clip.contactTime,
    presentation: { version: 1, engine: "baseline", engineOutcome: "ready",
      analysisState: clip.fix ? "supported_finding" : "no_supported_issue", fixState: clip.fix ? "shown" : "none_found",
      strengthsState: clip.strengths.length ? "shown" : "none_found", summaryState: "shown",
      familyReason: null, limited: false, reasonCodes: [], momentLabel: null },
    report: {
      state: "ready",
      summary: clip.summary,
      strengths: clip.strengths,
      fix: clip.fix,
      drills: clip.fix ? [drill] : [],
    },
  };
}

export function demoShowcase(playerId, basePath, clipId = null) {
  const reports = Object.fromEntries(clips.map((clip) => [clip.id, reportFor(clip, playerId, basePath)]));
  if (clipId) return reports[clipId] ?? null;
  const thenClip = clips.find((clip) => clip.id === "emily-clip-001");
  const nowClip = clips.find((clip) => clip.id === "emily-clip-003");
  return {
    playerId,
    playerName: PLAYER_NAME,
    reports,
    featuredClipId: "emily-clip-003",
    feed: clips.map((clip) => ({
      id: clip.id,
      entryId: clip.entryId,
      date: REVIEW_DATE,
      kind: "game",
      result: null,
      status: "ready",
      headline: clip.headline,
    })),
    progress: {
      current: {
        concept: "load-timing",
        title: "Same load, every pitch",
        description: "Build one repeatable load: hands back, weight back, then go. The goal is the same load on every pitch, not a bigger one.",
        status: "improving",
        startedAt: "2026-10-01T17:26:10.772633-04:00",
        seen: null,
        windowSize: 4,
      },
      status: "improving",
      windowSize: 4,
      summary: "Coach review: Load was better in AB 2 than in AB 1.",
      practice: null,
      focusDrill: drill,
      thenClipId: thenClip.id,
      nowClipId: nowClip.id,
      thenLabel: "AB 1",
      nowLabel: "AB 2",
      thenVideo: { clipId: thenClip.id, url: mediaUrl(basePath, thenClip.mediaPath), contactTime: thenClip.contactTime },
      nowVideo: { clipId: nowClip.id, url: mediaUrl(basePath, nowClip.mediaPath), contactTime: nowClip.contactTime },
      observations: [{
        date: REVIEW_DATE,
        status: "Improving",
        note: "Load was better in AB 2 than in AB 1.",
      }],
      history: [],
    },
  };
}
