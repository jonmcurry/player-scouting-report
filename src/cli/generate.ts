#!/usr/bin/env node
/**
 * Reads a player's GAME_LOG/CHECKLIST/ISSUES data back out of Supabase and
 * writes it into their existing report HTML, replacing only those three data
 * blocks - full regeneration of those blocks every run (idempotent), NOT the
 * one-way "never touch a hand-filled report" behavior of the old
 * generate_team_reports.ps1. That's a deliberate behavior change: Supabase is
 * now the only place these three sections get edited.
 *
 * Scope note: this does NOT regenerate the whole page. A real report still
 * has hand-authored content with no schema-backed representation (the
 * header/title itself, the game-log narrative note) - that's untouched here.
 * As of 00003_diagnosis_comps_plan.sql, the "2-5. Diagnosis, Comps & Plan"
 * section's Reference Comp table/notes, Drill Recommendations, and Follow-up
 * fields ARE modeled (comp_recommendations/comp_notes/drill_recommendations
 * + two players columns) and ARE regenerated here, via replaceDetailsBody
 * rather than replaceConstArray since this content was always static HTML,
 * never a JS data literal. When a section has no rows, the exact,
 * byte-verified placeholder markup (confirmed against real unfilmed report
 * files) is rendered instead of empty content, so running this against an
 * unfilmed player's report doesn't erase its "not filmed yet" copy.
 * Team_summary.html's PLAYERS row (scores[] / reviewedCount) sync is a known
 * follow-up, not yet built.
 *
 * The report's own embedded <script> already implements badge rendering,
 * the MIN_ATBATS_FOR_PATTERN early-read warning, and Trend-column history
 * display - reusing the existing template's client-side JS by only
 * replacing its data (instead of reimplementing that rendering logic here
 * in TypeScript) is what guarantees checkpoint-for-checkpoint fidelity with
 * what the browser actually renders, by construction, not by re-derivation.
 *
 * Usage:
 *   npm run build:reports -- --report reports/latham-lady-bison-white-10u/emily_c.html
 */
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getSupabaseClient } from "../services/db/supabaseClient.js";
import {
  jsStringLiteral,
  replaceConstArray,
  replaceDetailsBody,
} from "../services/html/reportBlocks.js";
import type { Score } from "../types/scouting.js";

const LEGACY_ROOT_TEAM_SLUG = "bethlehem-boom-10u";

function deriveTeamSlug(reportPath: string): string {
  const dir = path.basename(path.dirname(reportPath));
  return dir === "reports" ? LEGACY_ROOT_TEAM_SLUG : dir;
}

interface DbGameLog {
  date: string;
  opponent: string;
  ab: number;
  pitch: string | null;
  result: string;
  clip_gcs_path: string | null;
}
interface DbChecklistRow {
  score: Score | null;
  ai_draft: Score | null;
  reviewed_by: string | null;
  notes: string;
  checkpoints: { label: string };
  checklist_score_history: { score: Score }[];
}
interface DbIssue {
  issue: string;
  seen_in_at_bats: string;
  likely_cause: string;
  effect: string;
  reviewed_by: string | null;
}
interface DbCompRecommendation {
  comp_name: string;
  cue: string;
}
interface DbCompNote {
  note: string;
}
interface DbDrillRecommendation {
  title: string;
  description: string;
}

/** Minimal HTML-text escaping for the raw string content written into these
 * details-body fragments - current real data has no "&"/"<"/">" characters,
 * but a coach editing this text through the future coach app could type one,
 * and unescaped output would corrupt the surrounding markup. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Exact, byte-verified boilerplate for a player with no comp table yet -
// copied from a real unfilmed report (reports/maggie_m.html) rather than
// paraphrased, so regenerating an unfilmed player's report doesn't erase its
// "not filmed yet" copy or the reference-bank menu coaches use to pick comps
// once film is available.
const COMP_SECTION_PLACEHOLDER =
  `        <p>Comp cues will be picked once the specific issue is identified from film — see the reference bank below for the menu of options.</p>\n` +
  `        <p class="comp-note">\n` +
  `          <b>Softball reference bank</b> (weight these most heavily — same sport, same rise-ball timing):\n` +
  `          <b>Jocelyn Alo</b> (Oklahoma) — coached to shorten a naturally long, powerful swing so she could control the zone and still drive mistake pitches without losing bat speed, good for a hitter who gets long/wild in pressure counts. (Source: espnW, 2018.)\n` +
  `          <b>Lauren Chamberlain</b> (Oklahoma) — coached to keep the barrel through the zone longer for backspin/lift instead of a short slashing chop, good for a hitter who's choppy or cuts her extension short. (Source: Tulsa World coach interview.)\n` +
  `          <b>Amanda Chidester</b> (Michigan/Team USA) — deliberately swings at less than full effort (her own estimate: ~85%) to stay consistent across the whole zone rather than max-effort every pitch, good for an all-or-nothing hitter who's erratic pitch to pitch. (Source: her own HitTrax interview.)\n` +
  `          <b>Sierra Romero</b> (Michigan) — lets the ball travel deep into the zone before releasing the barrel, contact near/just behind the front foot, back heel barely lifts at contact, good for a hitter rushing or lunging at the ball. (Source: FloSoftball swing breakdown.)\n` +
  `          <b>Natasha Watley</b> (UCLA/Team USA) — documented slap technique: crossover-step footwork toward the pull side, barrel kept behind the hands, contact on top/back of the ball, no big follow-through — good for a speed-oriented hitter or anyone whose hands get ahead of the barrel. (Source: Applied Vision Softball technique breakdown, not a first-person Watley quote.)\n` +
  `          <b>Haylie McCleney</b> (Alabama/Team USA) — her own stated principle: elite hitters sequence hips → torso → shoulders → barrel from the ground up, and discipline means waiting for a pitcher's mistake rather than swinging just because the mechanics feel good — good for the swing-decisions checkpoint specifically (chasing pitches, not just poor mechanics). (Source: her own coaching blog.)\n` +
  `        </p>\n` +
  `        <p class="comp-note">\n` +
  `          <b>MLB reference bank</b> (isolated, named cues for individual mechanics only — not literal swing templates, and a much weaker fit for anything rise-ball- or underhand-timing-specific than the softball bank above):\n` +
  `          <b>Shoeless Joe Jackson</b> — fluid rhythm, good for a stiff/mechanical swing.\n` +
  `          <b>Ty Cobb</b> — contact-first control via a split-hand grip, good for an overswinger.\n` +
  `          <b>Pete Rose</b> — short/level/on-plane, good for choppers or uppercutters.\n` +
  `          <b>Ted Williams</b> — his well-documented cue (from his own writing) is a slight upward bat path to match the pitch's downward plane, good for a hitter chopping down on the ball.\n` +
  `          <b>Barry Bonds</b> — elite, well-documented hip-to-hand rotational separation, good for a hitter relying on arms instead of sequencing/torque.\n` +
  `          <b>Lou Gehrig</b> — less documented as a specific swing technique than the others here; his real legacy is remarkable day-to-day consistency and preparation (2,130 consecutive games) — use as a cue for building a repeatable pre-pitch routine, not a specific mechanical fix.\n` +
  `          <b>Babe Ruth</b> — full hip turn and extension for power, good for an arm-only hitter.\n` +
  `          <b>Ichiro Suzuki</b> — hands inside the ball, slap-style control, good for a caster or slapper-type hitter.\n` +
  `        </p>`;

const DRILLS_SECTION_PLACEHOLDER =
  `        <p>Drills will be recommended once the primary issue(s) are identified from film.</p>`;

// 4/6-space indentation matches the existing templates' own style exactly
// (confirmed by diffing generate.ts's output against a real report) - purely
// cosmetic, but keeping it byte-consistent makes future manual diffs/reviews
// of generated reports readable instead of a wall of whitespace noise.
function serializeGameLog(rows: DbGameLog[]): string {
  if (rows.length === 0) return "[]";
  const lines = rows.map(
    (g) =>
      `    { date: ${jsStringLiteral(g.date)}, opponent: ${jsStringLiteral(g.opponent)}, ` +
      `ab: ${g.ab}, pitch: ${jsStringLiteral(g.pitch)}, result: ${jsStringLiteral(g.result)}, ` +
      `clip: ${jsStringLiteral(g.clip_gcs_path)} },`,
  );
  return `[\n${lines.join("\n")}\n  ]`;
}

function serializeChecklist(rows: DbChecklistRow[]): string {
  if (rows.length === 0) return "[]";
  const lines = rows.map((r) => {
    const history = r.checklist_score_history.map((h) => h.score).join(", ");
    return (
      `    { label: ${jsStringLiteral(r.checkpoints.label)}, score: ${r.score ?? "null"}, ` +
      `aiDraft: ${r.ai_draft ?? "null"}, reviewedBy: ${jsStringLiteral(r.reviewed_by)}, ` +
      `history: [${history}], notes: ${jsStringLiteral(r.notes)} },`
    );
  });
  return `[\n${lines.join("\n")}\n  ]`;
}

function serializeIssues(rows: DbIssue[]): string {
  if (rows.length === 0) return "[]";
  const lines = rows.map(
    (i) =>
      `    {\n` +
      `      issue: ${jsStringLiteral(i.issue)},\n` +
      `      seenInAtBats: ${jsStringLiteral(i.seen_in_at_bats)},\n` +
      `      likelyCause: ${jsStringLiteral(i.likely_cause)},\n` +
      `      effect: ${jsStringLiteral(i.effect)},\n` +
      `      reviewedBy: ${jsStringLiteral(i.reviewed_by)},\n` +
      `    },`,
  );
  return `[\n${lines.join("\n")}\n  ]`;
}

function serializeCompSection(comps: DbCompRecommendation[], notes: DbCompNote[]): string {
  if (comps.length === 0) return COMP_SECTION_PLACEHOLDER;

  const rows = comps
    .map(
      (c) =>
        `            <tr><td>${escapeHtml(c.comp_name)}</td><td>${escapeHtml(c.cue)}</td></tr>`,
    )
    .join("\n");
  const notesHtml = notes
    .map((n) => `        <p class="comp-note">${escapeHtml(n.note)}</p>`)
    .join("\n");

  return (
    `        <table class="comp-table">\n` +
    `          <tbody>\n${rows}\n          </tbody>\n` +
    `        </table>` +
    (notesHtml ? `\n${notesHtml}` : "")
  );
}

function serializeDrillsSection(drills: DbDrillRecommendation[]): string {
  if (drills.length === 0) return DRILLS_SECTION_PLACEHOLDER;

  const items = drills
    .map(
      (d) =>
        `          <li><b>${escapeHtml(d.title)}</b> — ${escapeHtml(d.description)}</li>`,
    )
    .join("\n");
  return `        <ul class="drills">\n${items}\n        </ul>`;
}

function serializeFollowUp(refilmBy: string | null, whatToCheckNext: string | null): string {
  return (
    `        <div class="followup">\n` +
    `          <div><b>Re-film by</b>${escapeHtml(refilmBy ?? "")}</div>\n` +
    `          <div><b>What to check next time</b>${escapeHtml(whatToCheckNext ?? "")}</div>\n` +
    `        </div>`
  );
}

export async function generateReport(reportPath: string): Promise<void> {
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Report not found: ${reportPath}`);
  }
  const teamSlug = deriveTeamSlug(reportPath);
  const playerSlug = path.basename(reportPath, ".html");
  const supabase = getSupabaseClient();

  const { data: player, error: playerErr } = await supabase
    .from("players")
    .select("id, name, refilm_by, what_to_check_next, teams!inner(slug)")
    .eq("slug", playerSlug)
    .eq("teams.slug", teamSlug)
    .single();
  if (playerErr || !player) {
    throw new Error(
      `No Supabase player found for team=${teamSlug} slug=${playerSlug} - ` +
        `run migrate.ts for this report first. (${playerErr?.message ?? "not found"})`,
    );
  }

  const [gameLogRes, checklistRes, issuesRes, compsRes, notesRes, drillsRes] = await Promise.all([
    supabase
      .from("game_log_entries")
      .select("date, opponent, ab, pitch, result, clip_gcs_path")
      .eq("player_id", player.id)
      .order("position"),
    supabase
      .from("checklist_scores")
      .select(
        "score, ai_draft, reviewed_by, notes, checkpoints!inner(label, sort_order), " +
          "checklist_score_history(score)",
      )
      .eq("player_id", player.id)
      .order("sort_order", { referencedTable: "checkpoints" }),
    supabase
      .from("issues")
      .select("issue, seen_in_at_bats, likely_cause, effect, reviewed_by")
      .eq("player_id", player.id),
    supabase
      .from("comp_recommendations")
      .select("comp_name, cue")
      .eq("player_id", player.id)
      .order("position"),
    supabase.from("comp_notes").select("note").eq("player_id", player.id).order("position"),
    supabase
      .from("drill_recommendations")
      .select("title, description")
      .eq("player_id", player.id)
      .order("position"),
  ]);
  if (gameLogRes.error) throw new Error(`Loading game logs: ${gameLogRes.error.message}`);
  if (checklistRes.error) throw new Error(`Loading checklist: ${checklistRes.error.message}`);
  if (issuesRes.error) throw new Error(`Loading issues: ${issuesRes.error.message}`);
  if (compsRes.error) throw new Error(`Loading comp recommendations: ${compsRes.error.message}`);
  if (notesRes.error) throw new Error(`Loading comp notes: ${notesRes.error.message}`);
  if (drillsRes.error) throw new Error(`Loading drill recommendations: ${drillsRes.error.message}`);

  let html = fs.readFileSync(reportPath, "utf-8");
  html = replaceConstArray(html, "GAME_LOG", serializeGameLog(gameLogRes.data as DbGameLog[]));
  html = replaceConstArray(
    html,
    "CHECKLIST",
    serializeChecklist(checklistRes.data as unknown as DbChecklistRow[]),
  );
  html = replaceConstArray(html, "ISSUES", serializeIssues(issuesRes.data as DbIssue[]));

  const compsBody = serializeCompSection(
    compsRes.data as DbCompRecommendation[],
    notesRes.data as DbCompNote[],
  );
  const drillsBody = serializeDrillsSection(drillsRes.data as DbDrillRecommendation[]);
  const followUpBody = serializeFollowUp(player.refilm_by, player.what_to_check_next);

  html = replaceDetailsBody(
    html,
    "Reference Comp — What a Fix Looks Like",
    `\n${compsBody}\n      `,
  );
  html = replaceDetailsBody(html, "Drill Recommendations", `\n${drillsBody}\n      `);
  html = replaceDetailsBody(html, "Follow-up", `\n${followUpBody}\n      `);

  fs.writeFileSync(reportPath, html);
  console.log(
    `Regenerated ${reportPath} from Supabase: ${gameLogRes.data!.length} game log entries, ` +
      `${checklistRes.data!.length} checklist rows, ${issuesRes.data!.length} issues, ` +
      `${compsRes.data!.length} comp row(s), ${drillsRes.data!.length} drill(s).`,
  );
}

async function main() {
  const program = new Command();
  program.requiredOption("--report <path>", "Path to an individual player report HTML file to regenerate");
  program.parse(process.argv);
  const opts = program.opts<{ report: string }>();

  try {
    await generateReport(opts.report);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
