import type { ReportPresentation } from "./reportPresentation.ts";
import type { assembleReport } from "./reportAssembly.ts";

type DrillCard = {
  name: string; bestFor: string; equipment: string; homeFriendly: boolean; requiresScreen: boolean;
  instructions: string; cue: string | null; looksRightWhen: string | null; commonMistakes: string[];
  demoUrl: string | null; demoTimestamp: string | null; sourceCredit: string | null;
};
type Video = { url: string; contactTime: number | null };

const drillCard = (drill: DrillCard): DrillCard => ({ name: drill.name, bestFor: drill.bestFor,
  equipment: drill.equipment, homeFriendly: drill.homeFriendly, requiresScreen: drill.requiresScreen,
  instructions: drill.instructions, cue: drill.cue, looksRightWhen: drill.looksRightWhen,
  commonMistakes: drill.commonMistakes, demoUrl: drill.demoUrl,
  demoTimestamp: drill.demoTimestamp, sourceCredit: drill.sourceCredit });
const video = (item: Video | null): Video | null => item ? { url: item.url, contactTime: item.contactTime } : null;

/** Explicit public projection: no database ID fields; signed media URLs remain opaque paths. */
export function sharedProgressPayload(source: {
  current: { concept: string; status: string; startedAt: string; seen: number; windowSize: number } | null;
  status: string; windowSize: number;
  history: { concept: string; status: string; startedAt: string; endedAt: string | null }[];
  practice: { seen: number; total: number } | null; focusDrill: DrillCard | null;
  thenVideo: Video | null; nowVideo: Video | null;
}, redact: (text: string) => string) {
  return { current: source.current ? { concept: redact(source.current.concept), status: source.current.status,
    startedAt: source.current.startedAt, seen: source.current.seen, windowSize: source.current.windowSize } : null,
    status: source.status, windowSize: source.windowSize,
    history: source.history.map((item) => ({ concept: redact(item.concept), status: item.status,
      startedAt: item.startedAt, endedAt: item.endedAt })), practice: source.practice,
    focusDrill: source.focusDrill ? drillCard(source.focusDrill) : null,
    thenVideo: video(source.thenVideo), nowVideo: video(source.nowVideo) };
}

export function sharedReportPayload(report: ReturnType<typeof assembleReport>, redact: (text: string) => string) {
  if (report.state !== "ready") return report;
  return { state: report.state, summary: report.summary, strengths: report.strengths,
    fix: report.fix ? { concept: redact(report.fix.concept), issue: report.fix.issue,
      evidence: report.fix.evidence, coachingCue: report.fix.coachingCue,
      lookForNext: report.fix.lookForNext } : null,
    drills: report.drills.map(drillCard) };
}

/** Public presentation projection: no text, identifiers or experimental reason codes. */
export function sharedPresentation(p: ReportPresentation): ReportPresentation {
  return { version: p.version, engine: p.engine, engineOutcome: p.engineOutcome,
    analysisState: p.analysisState, fixState: p.fixState, strengthsState: p.strengthsState,
    summaryState: p.summaryState, familyReason: p.familyReason, limited: p.limited,
    reasonCodes: [], momentLabel: p.momentLabel };
}
