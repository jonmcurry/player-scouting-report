/**
 * The human-authored curation manifest (demo-curation.json). It is the ONLY
 * way a real clip becomes eligible for the public demo: no manifest entry,
 * no export. It also carries every piece of metadata that can't be safely
 * derived from video (publication consent, public display name, trim
 * bounds, at-bat/pitch corrections) - the exporter never invents these.
 *
 * Plain JSON (not YAML) so it needs no new dependency and round-trips
 * through the same tooling as the fixture itself. See
 * docs/research/demo-real-data-promotion.md and
 * docs/research/demo-curation.example.json.
 */

export interface TrimBounds { startS: number; endS: number }

export interface GameLogOverrides {
  date?: string; opponent?: string; ab?: number; result?: string; pitch?: string;
  pitch_zone?: number | null; pitch_outcome?: string | null;
}
export interface PitchOverrides {
  count_before_balls?: number; count_before_strikes?: number; pitch_type?: string | null;
  pitch_location?: string | null; pitch_zone?: number | null; pitch_outcome?: string; swung?: boolean;
}
export interface RepOverrides { grouping?: "baseline" | "drill" | "post_drill" | "free_swing" | "other" }

export interface CuratedClip {
  /** Exactly one of sourceClipId / clipSlug identifies the local clip. */
  sourceClipId?: string;
  clipSlug?: string;
  /** Media window in SOURCE-VIDEO seconds, or "full" (explicit opt-in to the whole file). */
  trim?: TrimBounds | "full";
  /** Local path to the original upload. Never written to any export artifact. */
  sourceVideo?: string;
  includeAudio?: boolean;
  /** Where analysis time 0 falls in the source video (overrides frames/<player>/<clip>/stage0.json). */
  analysisWindowStartS?: number;
  /** Explicitly allow media longer than MAX_MEDIA_SECONDS. */
  allowLongMedia?: boolean;
  /** Privacy-treated media for this clip: <dir>/<name>.{mp4,summary.json,validation.json} from scripts/privacy/. */
  privacy?: { name: string; dir?: string };
  /** Human-audited phase allowlist and corrections for the demo copy only. */
  phaseReview?: { include: string[]; overrides?: Record<string, { frame: number; timeS: number; method?: string; confidence?: "low" | "medium" | "high"; reconstructionReliable?: boolean }> };
  overrides?: { gameLogEntry?: GameLogOverrides; atBatPitch?: PitchOverrides; practiceRepetition?: RepOverrides };
  /**
   * Fields the human explicitly declares UNVERIFIED for publication: exported as
   * null (recorded as an override) instead of failing as "missing". A truthful
   * "unknown", never a fabricated value. Limited to the fields below.
   */
  publishAsUnknown?: {
    gameLogEntry?: ("opponent" | "result")[];
    atBatPitch?: ("count_before_balls" | "count_before_strikes" | "pitch_outcome" | "swung")[];
    /** Swing metrics that can't be truthfully labeled for a coach (uncalibrated, artifacts, unreliable contact frame). movement_flags publishes as {}. */
    videoClipMetrics?: string[];
    /**
     * The analysis run's unreviewed AI "no action needed" conclusion. Both fields together: the
     * schema requires a reason whenever no_action_needed is true, so the run is published as a
     * finished run with no draft finding (no_action_needed false, reason null).
     */
    analysisRun?: ("no_action_needed" | "no_action_reason")[];
  };
}

export interface CurationManifest {
  manifestVersion: 1;
  /**
   * Exercise the pipeline on real footage BEFORE the human consent/metadata
   * checkpoint: missing human facts become "UNCONFIRMED" warnings, the fixture
   * is stamped localValidationOnly, fixtureId must start with "local-", and
   * neither the import CLI nor the database (00038) will store or publish it
   * anywhere but a local stack with the dev setting on.
   */
  localValidationOnly?: boolean;
  /**
   * "privacy-treated" (default): every clip's media must be the anonymized output that passed
   * scripts/privacy/ and has a matching human approval. "raw-transcode" (plain trim + transcode of
   * the original) is allowed ONLY for localValidationOnly manifests.
   */
  mediaPolicy?: "privacy-treated" | "raw-transcode";
  /** Default directory for clips[].privacy (defaults to demo-export/privacy). */
  privacyDir?: string;
  /** Human publication approvals for treated media (JSON { approvals: [...] }). */
  privacyApprovals?: string;
  /**
   * Terms that must never appear in any public fixture value (e.g. a surname or
   * real team name the family has not authorized). Case-insensitive; the build fails
   * closed on any hit. Lives only in the local, gitignored manifest.
   */
  forbiddenPublicTerms?: string[];
  fixtureId: string;
  fixtureVersion: string;
  /**
   * Version tag used in public media filenames (default: fixtureVersion). Set it to an earlier
   * version's tag when a new fixture version republishes byte-identical media, so the live media
   * URLs stay the same and the earlier version remains a working rollback target.
   */
  mediaFileVersion?: string;
  source: { teamSlug: string; playerSlug: string };
  publication?: { consentConfirmedBy: string; consentConfirmedAt: string; note?: string };
  /** The visitor's demo team, exactly as publication permission allows (e.g. the real team name, or a neutral label). */
  team: { publicName: string; sport?: "softball" | "baseball"; levelLabel?: string };
  player: { publicName: string; publicSlug: string; jerseyNumber?: string; ageBand?: string; bats?: "L" | "R" | "S"; throws?: "L" | "R"; whatToCheckNext?: string };
  /** Replaces every coach name in reviewed_by/changed_by. Required when any reviewed row is exported. */
  reviewerDisplayName?: string;
  clips: CuratedClip[];
  /** "all" = every non-archived priority; or an explicit list of source priority ids. */
  priorities: "all" | "none" | string[];
  findings?: { includeDrafts?: boolean };
  checklist?: { includeRejectedStates?: boolean };
  /** Optional presentation exclusions for evidence the reviewed demo will not show. */
  analysis?: { includePose3d?: boolean; scrubInputManifest?: boolean; scrubDerivedEvidence?: boolean };
  report?: { shareLink?: boolean };
  expect?: {
    requirePose3d?: boolean;
    requireMetrics?: boolean;
    comparePairs?: Array<"baseline_post" | "game_game" | "priority_before_after">;
  };
}

export interface ManifestProblem { path: string; message: string }

const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function nonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export const PUBLISH_UNKNOWN = {
  gameLogEntry: ["opponent", "result"],
  atBatPitch: ["count_before_balls", "count_before_strikes", "pitch_outcome", "swung"],
  videoClipMetrics: [
    "max_bat_speed_value", "max_bat_speed_unit", "max_bat_speed_search_window_s", "max_bat_speed_frame",
    "max_bat_speed_full_rate_value", "max_bat_speed_full_rate_source_fps", "attack_angle_at_contact_deg",
    "hip_shoulder_separation_at_contact_deg", "torso_tilt_at_contact_deg", "pelvis_tilt_at_contact_deg",
    "lead_side", "lead_side_method", "lead_elbow_angle_at_contact_deg", "front_knee_angle_at_contact_deg",
    "l_elbow_angle_at_contact_deg", "r_elbow_angle_at_contact_deg", "stride_length_hip_widths",
    "stride_direction_deg", "stride_note", "movement_flags",
  ],
  analysisRun: ["no_action_needed", "no_action_reason"],
};

/** Structural validation. Returns problems instead of throwing so the CLI can report all of them at once. */
export function parseCurationManifest(raw: unknown): { manifest: CurationManifest | null; problems: ManifestProblem[] } {
  const p: ManifestProblem[] = [];
  const add = (path: string, message: string) => p.push({ path, message });
  if (!isObj(raw)) return { manifest: null, problems: [{ path: "$", message: "manifest must be a JSON object" }] };

  if (raw.manifestVersion !== 1) add("manifestVersion", "must be 1");
  // An unfilled worksheet placeholder is never a real answer (a non-empty
  // "REQUIRED FROM USER" would otherwise satisfy every presence check).
  const walk = (v: unknown, path: string): void => {
    if (typeof v === "string" && /REQUIRED FROM USER|REQUIRED-FROM-USER/i.test(v)) add(path, "still a placeholder - fill it in (see the review worksheet)");
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (isObj(v)) for (const [k, x] of Object.entries(v)) if (!k.startsWith("_")) walk(x, path === "$" ? k : `${path}.${k}`);
  };
  walk(raw, "$");
  if (typeof raw.fixtureId !== "string" || !SLUG.test(raw.fixtureId)) add("fixtureId", "must be a lowercase slug (a-z, 0-9, -), 2-63 chars");
  if (!nonEmpty(raw.fixtureVersion)) add("fixtureVersion", "required (e.g. 2026-09-22.1)");

  const source = raw.source;
  if (!isObj(source) || !nonEmpty(source.teamSlug) || !nonEmpty(source.playerSlug)) add("source", "teamSlug and playerSlug are required");

  const localOnly = raw.localValidationOnly === true;
  if (raw.localValidationOnly !== undefined && typeof raw.localValidationOnly !== "boolean") add("localValidationOnly", "must be a boolean");
  if (localOnly && !(typeof raw.fixtureId === "string" && raw.fixtureId.startsWith("local-"))) add("fixtureId", 'a localValidationOnly fixtureId must start with "local-"');
  if (!localOnly && typeof raw.fixtureId === "string" && raw.fixtureId.startsWith("local-")) add("fixtureId", '"local-" fixture ids are reserved for localValidationOnly manifests');

  const pub = raw.publication;
  if (localOnly && pub === undefined) {
    // consent intentionally not recorded yet - see localValidationOnly
  } else if (!isObj(pub) || !nonEmpty(pub.consentConfirmedBy) || !nonEmpty(pub.consentConfirmedAt)) {
    add("publication", "consentConfirmedBy and consentConfirmedAt are required - a human must confirm publication consent for a real athlete");
  } else if (!DATE.test(String(pub.consentConfirmedAt))) {
    add("publication.consentConfirmedAt", "must be YYYY-MM-DD");
  }

  const team = raw.team;
  if (!isObj(team) || !nonEmpty(team.publicName)) {
    add("team.publicName", "required - the demo team's public name, exactly as publication permission allows (never defaulted to the real team)");
  } else if (team.sport !== undefined && !["softball", "baseball"].includes(String(team.sport))) {
    add("team.sport", "must be softball or baseball");
  }

  const player = raw.player;
  if (!isObj(player)) {
    add("player", "required");
  } else {
    if (!nonEmpty(player.publicName)) add("player.publicName", "required - the exporter never defaults to the athlete's real name");
    if (typeof player.publicSlug !== "string" || !SLUG.test(player.publicSlug)) add("player.publicSlug", "required lowercase slug");
    if (player.bats !== undefined && !["L", "R", "S"].includes(String(player.bats))) add("player.bats", "must be L, R, or S");
    if (player.throws !== undefined && !["L", "R"].includes(String(player.throws))) add("player.throws", "must be L or R");
    if (player.ageBand !== undefined && !["u8", "8-10", "11-12", "13-14", "15-18", "adult"].includes(String(player.ageBand))) add("player.ageBand", "not a valid age band");
    if (player.whatToCheckNext !== undefined && !nonEmpty(player.whatToCheckNext)) add("player.whatToCheckNext", "must be a non-empty string when present");
  }
  if (raw.reviewerDisplayName !== undefined && !nonEmpty(raw.reviewerDisplayName)) add("reviewerDisplayName", "must be a non-empty string when present");

  if (!Array.isArray(raw.clips) || raw.clips.length === 0) {
    add("clips", "at least one explicitly selected clip is required (the manifest IS the allowlist)");
  } else {
    const seen = new Set<string>();
    raw.clips.forEach((c, i) => {
      const at = `clips[${i}]`;
      if (!isObj(c)) { add(at, "must be an object"); return; }
      const hasId = c.sourceClipId !== undefined, hasSlug = c.clipSlug !== undefined;
      if (hasId === hasSlug) add(at, "exactly one of sourceClipId or clipSlug is required");
      if (hasId && (typeof c.sourceClipId !== "string" || !UUID.test(c.sourceClipId))) add(`${at}.sourceClipId`, "must be a uuid");
      if (hasSlug && !nonEmpty(c.clipSlug)) add(`${at}.clipSlug`, "must be a non-empty string");
      const key = String(c.sourceClipId ?? c.clipSlug);
      if (seen.has(key)) add(at, `duplicate clip selection "${key}"`);
      seen.add(key);
      if (c.trim !== undefined && c.trim !== "full") {
        if (!isObj(c.trim) || typeof c.trim.startS !== "number" || typeof c.trim.endS !== "number" || !(c.trim.startS >= 0) || !(c.trim.endS > c.trim.startS)) {
          add(`${at}.trim`, 'must be "full" or { startS >= 0, endS > startS }');
        }
      }
      if (c.analysisWindowStartS !== undefined && !(typeof c.analysisWindowStartS === "number" && c.analysisWindowStartS >= 0)) add(`${at}.analysisWindowStartS`, "must be a number >= 0");
      if (c.sourceVideo !== undefined && !nonEmpty(c.sourceVideo)) add(`${at}.sourceVideo`, "must be a non-empty path");
      if (c.overrides !== undefined && !isObj(c.overrides)) add(`${at}.overrides`, "must be an object");
      if (c.phaseReview !== undefined) {
        const pr = c.phaseReview;
        const allowed = ["stance", "load", "stride", "contact", "extension", "follow-through"];
        if (!isObj(pr) || !Array.isArray(pr.include) || pr.include.length === 0 || pr.include.some((x) => !allowed.includes(String(x))) || new Set(pr.include).size !== pr.include.length) {
          add(`${at}.phaseReview.include`, "must list unique known phases");
        } else if (pr.overrides !== undefined && (!isObj(pr.overrides) || Object.entries(pr.overrides).some(([slug, v]) => !(pr.include as string[]).includes(slug) || !isObj(v) || !Number.isInteger(v.frame) || (v.frame as number) < 0 || typeof v.timeS !== "number" || v.timeS < 0 || (v.method !== undefined && !nonEmpty(v.method)) || (v.confidence !== undefined && !["low", "medium", "high"].includes(String(v.confidence))) || (v.reconstructionReliable !== undefined && typeof v.reconstructionReliable !== "boolean")))) {
          add(`${at}.phaseReview.overrides`, "must contain valid corrections for included phases only");
        }
      }
      if (c.publishAsUnknown !== undefined) {
        const u = c.publishAsUnknown;
        const okList = (v: unknown, allowed: string[]) => v === undefined || (Array.isArray(v) && v.every((x) => allowed.includes(String(x))));
        const groups = Object.keys(PUBLISH_UNKNOWN) as (keyof typeof PUBLISH_UNKNOWN)[];
        if (!isObj(u) || Object.keys(u).some((k) => !groups.includes(k as keyof typeof PUBLISH_UNKNOWN)) || !groups.every((g) => okList(u[g], PUBLISH_UNKNOWN[g]))) {
          add(`${at}.publishAsUnknown`, `only ${groups.map((g) => `${g}: ${PUBLISH_UNKNOWN[g].join("/")}`).join("; ")} may be declared unknown`);
        } else {
          const ar = (u.analysisRun as string[] | undefined) ?? [];
          if (ar.length && !(ar.includes("no_action_needed") && ar.includes("no_action_reason"))) add(`${at}.publishAsUnknown`, "analysisRun must withhold no_action_needed and no_action_reason together");
          const ov = isObj(c.overrides) ? c.overrides : {};
          for (const [grp, cols] of Object.entries(u) as [string, string[]][]) {
            for (const col of cols ?? []) if (isObj(ov[grp]) && col in (ov[grp] as object)) add(`${at}.publishAsUnknown`, `${grp}.${col} is both overridden and declared unknown`);
          }
        }
      }
    });
  }

  const pr = raw.priorities;
  if (!(pr === "all" || pr === "none" || (Array.isArray(pr) && pr.every((x) => typeof x === "string" && UUID.test(x))))) {
    add("priorities", 'required: "all", "none", or a list of source priority uuids (priorities are coach conclusions - include them deliberately)');
  }
  if (raw.analysis !== undefined) {
    if (!isObj(raw.analysis)) add("analysis", "must be an object when present");
    else {
      if (raw.analysis.includePose3d !== undefined && typeof raw.analysis.includePose3d !== "boolean") add("analysis.includePose3d", "must be a boolean when present");
      if (raw.analysis.scrubInputManifest !== undefined && typeof raw.analysis.scrubInputManifest !== "boolean") add("analysis.scrubInputManifest", "must be a boolean when present");
      if (raw.analysis.scrubDerivedEvidence !== undefined && typeof raw.analysis.scrubDerivedEvidence !== "boolean") add("analysis.scrubDerivedEvidence", "must be a boolean when present");
    }
  }
  if (raw.checklist !== undefined && (!isObj(raw.checklist) || (raw.checklist.includeRejectedStates !== undefined && typeof raw.checklist.includeRejectedStates !== "boolean"))) {
    add("checklist.includeRejectedStates", "must be a boolean when present");
  }
  if (raw.mediaFileVersion !== undefined && !(nonEmpty(raw.mediaFileVersion) && /^[A-Za-z0-9][A-Za-z0-9._-]{0,40}$/.test(String(raw.mediaFileVersion)))) add("mediaFileVersion", "must be a version tag like 2026-09-24.2");
  if (raw.mediaPolicy !== undefined && !["privacy-treated", "raw-transcode"].includes(String(raw.mediaPolicy))) add("mediaPolicy", 'must be "privacy-treated" or "raw-transcode"');
  if (raw.mediaPolicy === "raw-transcode" && !localOnly) add("mediaPolicy", '"raw-transcode" (untreated footage) is only allowed for localValidationOnly manifests');
  if (Array.isArray(raw.clips)) raw.clips.forEach((c, i) => {
    if (isObj(c) && c.privacy !== undefined && !(isObj(c.privacy) && nonEmpty(c.privacy.name) && /^[a-z0-9][a-z0-9_-]{0,62}$/.test(String(c.privacy.name)))) add(`clips[${i}].privacy`, "must be { name: <treated clip name> }");
  });
  if (raw.forbiddenPublicTerms !== undefined && !(Array.isArray(raw.forbiddenPublicTerms) && raw.forbiddenPublicTerms.every((t) => typeof t === "string" && t.trim().length >= 3))) {
    add("forbiddenPublicTerms", "must be a list of strings (3+ characters each)");
  }
  const pairs = isObj(raw.expect) ? raw.expect.comparePairs : undefined;
  if (pairs !== undefined && !(Array.isArray(pairs) && pairs.every((k) => ["baseline_post", "game_game", "priority_before_after"].includes(String(k))))) {
    add("expect.comparePairs", "unknown compare pair kind");
  }

  return { manifest: p.length ? null : (raw as unknown as CurationManifest), problems: p };
}
