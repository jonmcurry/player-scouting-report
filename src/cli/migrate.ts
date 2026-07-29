#!/usr/bin/env node
/**
 * One-time data migration: parse an existing hand-filled report HTML file
 * (reports/<team-slug>/<player-slug>.html, or reports/<player-slug>.html for
 * the legacy root-level Bethlehem Boom team) and seed its embedded
 * GAME_LOG/CHECKLIST/ISSUES data into Supabase.
 *
 * After this, Supabase becomes the source of truth for that player - further
 * edits happen there (via Studio, a future coach UI, or ingest.ts/
 * geminiAnalyzer.ts), and `generate.ts` regenerates the HTML from Supabase.
 * This script is meant to run once per existing report to bootstrap that
 * transition, though it's safe to re-run (game logs/checklist/issues for the
 * player are fully replaced each run, not appended).
 *
 * Usage:
 *   npm run migrate -- --report reports/latham-lady-bison-white-10u/emily_c.html
 *   npm run migrate -- --report reports/maggie_m.html   (legacy root-level team)
 */
import { Command } from "commander";
import * as cheerio from "cheerio";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getSupabaseClient } from "../services/db/supabaseClient.js";
import { extractConstArray, extractDetailsBodyHtml } from "../services/html/reportBlocks.js";
import type { Score } from "../types/scouting.js";

const LEGACY_ROOT_TEAM_SLUG = "bethlehem-boom-10u";

interface RawGameLogEntry {
  date: string;
  opponent: string;
  ab: number;
  pitch: string | null;
  result: string;
  clip: string | null;
  // Added 2026-07-28 to the report template, so older already-hand-filled
  // reports may not have this key at all - undefined reads the same as null.
  outcome?: "take" | "foul-no-advance" | "ball-in-play" | null;
}
interface RawChecklistEntry {
  label: string;
  score: Score | null;
  aiDraft: Score | null;
  reviewedBy: string | null;
  history: Score[];
  notes: string;
  // Added 2026-07-28 alongside GAME_LOG's "outcome" - same optional-key caveat.
  atBats?: number[];
}
interface RawIssueEntry {
  issue: string;
  seenInAtBats: string;
  likelyCause: string;
  effect: string;
  reviewedBy: string | null;
  atBats?: number[];
}
interface RawCompRecommendation {
  compName: string;
  cue: string;
}
interface RawDrillRecommendation {
  title: string;
  description: string;
}
interface RawFollowUp {
  refilmBy: string | null;
  whatToCheckNext: string | null;
}

function extractPlayerNameAndJersey(html: string): { name: string; jerseyNumber: string } {
  const match = html.match(/<title>BarrelIQ Swing Report — (.+?) \(#(\w+)\)<\/title>/);
  if (!match) {
    throw new Error(
      'Could not find `<title>BarrelIQ Swing Report — Name (#N)</title>` - is this an individual player report?',
    );
  }
  const [, name, jerseyNumber] = match;
  return { name: name!, jerseyNumber: jerseyNumber! };
}

/**
 * Parses the "Reference Comp — What a Fix Looks Like" details-body. Returns
 * empty arrays for the placeholder ("not filmed yet") state, which - contrary
 * to how it looks at a glance - is NOT just a bare sentence: it also contains
 * `<p class="comp-note">` elements (a static reference-bank menu of options),
 * the same CSS class real per-player notes use. Gating on the presence of a
 * sibling `table.comp-table` is the only reliable way to tell "real per-player
 * note" from "generic boilerplate" - confirmed by diffing real filmed vs.
 * unfilmed report files directly.
 */
function parseCompSection(html: string): {
  comps: RawCompRecommendation[];
  notes: string[];
} {
  const body = extractDetailsBodyHtml(html, "Reference Comp — What a Fix Looks Like");
  if (!body) return { comps: [], notes: [] };

  const $ = cheerio.load(body);
  const table = $("table.comp-table");
  if (table.length === 0) {
    return { comps: [], notes: [] };
  }

  const comps: RawCompRecommendation[] = [];
  table.find("tr").each((_, tr) => {
    const cells = $(tr).find("td");
    if (cells.length < 2) return;
    comps.push({
      compName: $(cells[0]).text().trim(),
      cue: $(cells[1]).text().trim(),
    });
  });

  const notes: string[] = [];
  $("p.comp-note").each((_, p) => {
    notes.push($(p).text().trim());
  });

  return { comps, notes };
}

/**
 * Parses the "Drill Recommendations" details-body. The placeholder state is a
 * single bare `<p>` with no `<ul class="drills">` - absence of that list is
 * the "not filmed yet" signal, same pattern as parseCompSection.
 */
function parseDrillsSection(html: string): RawDrillRecommendation[] {
  const body = extractDetailsBodyHtml(html, "Drill Recommendations");
  if (!body) return [];

  const $ = cheerio.load(body);
  const list = $("ul.drills");
  if (list.length === 0) return [];

  const drills: RawDrillRecommendation[] = [];
  list.find("li").each((_, li) => {
    const $li = $(li);
    const title = $li.find("b").first().text().trim();
    const fullText = $li.text().trim();
    const description = fullText.slice(title.length).replace(/^\s*[—-]\s*/, "").trim();
    drills.push({ title, description });
  });
  return drills;
}

/**
 * Parses the "Follow-up" details-body's two fixed fields. Real markup has the
 * bold label directly concatenated to the value with no separator
 * (`<div><b>Re-film by</b>Next game</div>`), unlike the drills list's
 * em-dash-separated format.
 */
function parseFollowUp(html: string): RawFollowUp {
  const body = extractDetailsBodyHtml(html, "Follow-up");
  if (!body) return { refilmBy: null, whatToCheckNext: null };

  const $ = cheerio.load(body);
  let refilmBy: string | null = null;
  let whatToCheckNext: string | null = null;

  $(".followup > div").each((_, div) => {
    const $div = $(div);
    const label = $div.find("b").first().text().trim();
    const value = $div.text().trim().slice(label.length).trim();
    if (/re-?film/i.test(label)) refilmBy = value;
    else if (/what to check/i.test(label)) whatToCheckNext = value;
  });

  return { refilmBy, whatToCheckNext };
}

function extractTeamName(teamSummaryHtml: string): string {
  const match = teamSummaryHtml.match(/<h1>BarrelIQ Team Overview — (.+?)<\/h1>/);
  if (!match) {
    throw new Error('Could not find `<h1>BarrelIQ Team Overview — Name</h1>` in team_summary.html');
  }
  return match[1]!;
}

function deriveTeamSlug(reportPath: string): string {
  const dir = path.basename(path.dirname(reportPath));
  // A report sitting directly in reports/ (dir === "reports") belongs to the
  // legacy root-level team, which predates the multi-team folder convention.
  return dir === "reports" ? LEGACY_ROOT_TEAM_SLUG : dir;
}

async function upsertTeam(slug: string, name: string): Promise<string> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("teams")
    .upsert({ slug, name }, { onConflict: "slug" })
    .select("id")
    .single();
  if (error) throw new Error(`Upserting team ${slug}: ${error.message}`);
  return data.id as string;
}

async function upsertPlayer(
  teamId: string,
  slug: string,
  name: string,
  jerseyNumber: string,
  followUp: RawFollowUp,
): Promise<string> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("players")
    .upsert(
      {
        team_id: teamId,
        slug,
        name,
        jersey_number: jerseyNumber,
        refilm_by: followUp.refilmBy,
        what_to_check_next: followUp.whatToCheckNext,
      },
      { onConflict: "team_id,slug" },
    )
    .select("id")
    .single();
  if (error) throw new Error(`Upserting player ${slug}: ${error.message}`);
  return data.id as string;
}

/**
 * Upserts by the (player_id, date, opponent, ab) natural key
 * (migration 00013) instead of delete-all-then-insert-fresh, which this
 * function used to do. That was a real, serious bug: video_clips.
 * game_log_entry_id cascades on delete, so simply re-running migrate.ts
 * (e.g. after editing a report's notes) silently destroyed every clip's
 * ingested video/pose3d data - found by directly checking real row counts
 * after a routine re-migration, not assumed safe from the docstring's own
 * "safe to re-run" claim. Upserting by natural key preserves the SAME
 * game_log_entries.id for an at-bat that already exists, so anything
 * hanging off it survives a re-migration. Only at-bats no longer present in
 * the new report get deleted (a genuinely removed/renamed entry), not
 * everything.
 */
async function replaceGameLogs(playerId: string, entries: RawGameLogEntry[]): Promise<void> {
  const supabase = getSupabaseClient();

  const { data: existing, error: existingErr } = await supabase
    .from("game_log_entries")
    .select("id, date, opponent, ab")
    .eq("player_id", playerId);
  if (existingErr) throw new Error(`Loading existing game logs: ${existingErr.message}`);

  const newKeys = new Set(entries.map((e) => `${e.date} ${e.opponent} ${e.ab}`));
  const staleIds = (existing ?? [])
    .filter((row) => !newKeys.has(`${row.date} ${row.opponent} ${row.ab}`))
    .map((row) => row.id as string);
  if (staleIds.length > 0) {
    const del = await supabase.from("game_log_entries").delete().in("id", staleIds);
    if (del.error) throw new Error(`Removing stale game logs: ${del.error.message}`);
  }
  if (entries.length === 0) return;

  const rows = entries.map((e, position) => ({
    player_id: playerId,
    date: e.date,
    opponent: e.opponent,
    ab: e.ab,
    pitch: e.pitch,
    result: e.result,
    // Local video path today - not yet migrated to a real GCS path. Fine to
    // carry over as-is for now; a separate future step uploads videos/*.mp4
    // and updates this column to a real gs:// path.
    clip_gcs_path: e.clip,
    outcome: e.outcome ?? null,
    // Source array index - see the position column's migration comment for
    // why (date isn't unique/monotonic enough across real report data).
    position,
  }));
  const ins = await supabase
    .from("game_log_entries")
    .upsert(rows, { onConflict: "player_id,date,opponent,ab" });
  if (ins.error) throw new Error(`Upserting game logs: ${ins.error.message}`);
}

async function replaceChecklist(playerId: string, entries: RawChecklistEntry[]): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: checkpoints, error: cpErr } = await supabase
    .from("checkpoints")
    .select("id, label");
  if (cpErr) throw new Error(`Loading checkpoints: ${cpErr.message}`);
  const labelToId = new Map((checkpoints ?? []).map((c) => [c.label, c.id as string]));

  const del = await supabase.from("checklist_scores").delete().eq("player_id", playerId);
  if (del.error) throw new Error(`Clearing checklist scores: ${del.error.message}`);
  if (entries.length === 0) return;

  const rows = entries.map((e) => {
    const checkpointId = labelToId.get(e.label);
    if (!checkpointId) {
      throw new Error(
        `Checklist label "${e.label}" doesn't match any seeded checkpoint - ` +
          `known labels: ${[...labelToId.keys()].join(", ")}`,
      );
    }
    return {
      player_id: playerId,
      checkpoint_id: checkpointId,
      score: e.score,
      ai_draft: e.aiDraft,
      reviewed_by: e.reviewedBy,
      notes: e.notes,
      at_bats: e.atBats ?? [],
      // Migrated legacy data's provenance (Claude-vision draft vs coach entry)
      // isn't reliably distinguishable from the HTML alone - only genuinely
      // new writes from geminiAnalyzer.ts/ingest.ts set 'gemini'/'pose3d'.
      source: null,
    };
  });
  const { data: inserted, error: insErr } = await supabase
    .from("checklist_scores")
    .insert(rows)
    .select("id, score");
  if (insErr) throw new Error(`Inserting checklist scores: ${insErr.message}`);

  // Backfill history as real audited rows (see the schema's rationale for
  // why history is a table, not an int[] column) - changed_at/changed_by are
  // unknown for migrated data, so only the score itself carries over.
  const historyRows: { checklist_score_id: string; score: Score }[] = [];
  entries.forEach((e, i) => {
    for (const histScore of e.history) {
      historyRows.push({ checklist_score_id: inserted![i]!.id as string, score: histScore });
    }
  });
  if (historyRows.length > 0) {
    const histIns = await supabase.from("checklist_score_history").insert(historyRows);
    if (histIns.error) throw new Error(`Inserting checklist history: ${histIns.error.message}`);
  }
}

async function replaceIssues(playerId: string, entries: RawIssueEntry[]): Promise<void> {
  const supabase = getSupabaseClient();
  const del = await supabase.from("issues").delete().eq("player_id", playerId);
  if (del.error) throw new Error(`Clearing issues: ${del.error.message}`);
  if (entries.length === 0) return;

  const rows = entries.map((e) => ({
    player_id: playerId,
    issue: e.issue,
    seen_in_at_bats: e.seenInAtBats,
    likely_cause: e.likelyCause,
    effect: e.effect,
    reviewed_by: e.reviewedBy,
    at_bats: e.atBats ?? [],
    source: null,
  }));
  const ins = await supabase.from("issues").insert(rows);
  if (ins.error) throw new Error(`Inserting issues: ${ins.error.message}`);
}

async function replaceCompRecommendations(
  playerId: string,
  comps: RawCompRecommendation[],
): Promise<void> {
  const supabase = getSupabaseClient();
  const del = await supabase.from("comp_recommendations").delete().eq("player_id", playerId);
  if (del.error) throw new Error(`Clearing comp recommendations: ${del.error.message}`);
  if (comps.length === 0) return;

  const rows = comps.map((c, position) => ({
    player_id: playerId,
    comp_name: c.compName,
    cue: c.cue,
    position,
  }));
  const ins = await supabase.from("comp_recommendations").insert(rows);
  if (ins.error) throw new Error(`Inserting comp recommendations: ${ins.error.message}`);
}

async function replaceCompNotes(playerId: string, notes: string[]): Promise<void> {
  const supabase = getSupabaseClient();
  const del = await supabase.from("comp_notes").delete().eq("player_id", playerId);
  if (del.error) throw new Error(`Clearing comp notes: ${del.error.message}`);
  if (notes.length === 0) return;

  const rows = notes.map((note, position) => ({ player_id: playerId, note, position }));
  const ins = await supabase.from("comp_notes").insert(rows);
  if (ins.error) throw new Error(`Inserting comp notes: ${ins.error.message}`);
}

async function replaceDrillRecommendations(
  playerId: string,
  drills: RawDrillRecommendation[],
): Promise<void> {
  const supabase = getSupabaseClient();
  const del = await supabase.from("drill_recommendations").delete().eq("player_id", playerId);
  if (del.error) throw new Error(`Clearing drill recommendations: ${del.error.message}`);
  if (drills.length === 0) return;

  const rows = drills.map((d, position) => ({
    player_id: playerId,
    title: d.title,
    description: d.description,
    position,
  }));
  const ins = await supabase.from("drill_recommendations").insert(rows);
  if (ins.error) throw new Error(`Inserting drill recommendations: ${ins.error.message}`);
}

export async function migrateReport(reportPath: string): Promise<void> {
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Report not found: ${reportPath}`);
  }
  const html = fs.readFileSync(reportPath, "utf-8");
  const { name, jerseyNumber } = extractPlayerNameAndJersey(html);
  const playerSlug = path.basename(reportPath, ".html");
  const teamSlug = deriveTeamSlug(reportPath);

  const teamSummaryPath = path.join(path.dirname(reportPath), "team_summary.html");
  const teamName = fs.existsSync(teamSummaryPath)
    ? extractTeamName(fs.readFileSync(teamSummaryPath, "utf-8"))
    : teamSlug;

  const gameLogs = extractConstArray<RawGameLogEntry>(html, "GAME_LOG");
  const checklist = extractConstArray<RawChecklistEntry>(html, "CHECKLIST");
  const issues = extractConstArray<RawIssueEntry>(html, "ISSUES");
  const { comps, notes } = parseCompSection(html);
  const drills = parseDrillsSection(html);
  const followUp = parseFollowUp(html);

  console.log(`Parsed ${name} (#${jerseyNumber}, ${teamSlug}): ` +
    `${gameLogs.length} game log entries, ${checklist.length} checklist rows, ${issues.length} issues, ` +
    `${comps.length} comp row(s), ${notes.length} comp note(s), ${drills.length} drill(s)`);

  const teamId = await upsertTeam(teamSlug, teamName);
  const playerId = await upsertPlayer(teamId, playerSlug, name, jerseyNumber, followUp);
  await replaceGameLogs(playerId, gameLogs);
  await replaceChecklist(playerId, checklist);
  await replaceIssues(playerId, issues);
  await replaceCompRecommendations(playerId, comps);
  await replaceCompNotes(playerId, notes);
  await replaceDrillRecommendations(playerId, drills);

  console.log(`Migrated ${name} into Supabase (team ${teamSlug}, player ${playerSlug}).`);
}

async function main() {
  const program = new Command();
  program.requiredOption("--report <path>", "Path to an individual player report HTML file");
  program.parse(process.argv);
  const opts = program.opts<{ report: string }>();

  try {
    await migrateReport(opts.report);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
