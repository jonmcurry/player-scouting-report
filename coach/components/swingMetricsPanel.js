// Surfaces metrics.py's summary numbers (bat speed, attack angle,
// hip-shoulder separation, torso/pelvis tilt, elbow/knee angles, stride) and
// the automated movement-pattern flags - all of it computed by the pose3d
// pipeline but, until now, only ever existing in the raw metrics.json file
// on disk with zero UI surface (confirmed by checking what player.html
// actually queried before this - only phase timestamps + a confidence
// badge). One concern per file, matching pitchZonePicker.js/stepper.js.
import { supabase } from "../shared.js";
import { METRIC_SOURCE_2D, METRIC_SOURCE_3D } from "./developmentLogic.js";

export async function loadSwingMetrics(videoClipId) {
  const { data } = await supabase
    .from("video_clip_metrics")
    .select("*")
    .eq("video_clip_id", videoClipId)
    .maybeSingle();
  return data ?? null;
}

function statTile(label, value, unit, source) {
  if (value === null || value === undefined) return "";
  return `
    <div class="stat-tile">
      <span class="stat-label">${label}</span>
      <div class="stat-value">${value}${unit ? ` <span class="hint">${unit}</span>` : ""}</div>
      <span class="metric-source estimated">${source}</span>
    </div>
  `;
}

/** Movement-pattern flags are AI-drafted, never-coach-reviewed content -
 * same .badge.ai-draft visual semantics this app already uses elsewhere for
 * exactly that (see player.html's issuesList rendering) - and always shows
 * its one-line caveat text alongside the value, never a bare number, so a
 * coach never mistakes a "low confidence" heuristic for a settled fact. */
function movementFlagRow(label, flag) {
  if (!flag || flag.value === null || flag.value === undefined) return "";
  const confSuffix = flag.confidence === "low" ? " (low confidence)" : "";
  const caveat = flag.detail && flag.detail.reason ? flag.detail.reason : flag.method;
  return `
    <div style="margin-top:8px;">
      <span class="badge ai-draft">${label}: ${flag.value}${confSuffix}</span>
      <p class="hint" style="margin:4px 0 0;">${caveat}</p>
    </div>
  `;
}

export function renderSwingMetricsPanel(container, metricsRow) {
  if (!metricsRow) {
    container.innerHTML = "";
    return;
  }

  const batSpeed = metricsRow.max_bat_speed_full_rate_value ?? metricsRow.max_bat_speed_value;
  const batSpeedSource = metricsRow.max_bat_speed_full_rate_value ? `${METRIC_SOURCE_2D} · full-rate refinement` : METRIC_SOURCE_2D;

  const tiles = [
    statTile("Bat Speed (2D)", batSpeed, "shoulder-widths/s, body-relative (not mph)", batSpeedSource),
    statTile("Attack Angle (2D)", metricsRow.attack_angle_at_contact_deg, "° in the image", METRIC_SOURCE_2D),
    statTile("Hip-Shoulder Sep", metricsRow.hip_shoulder_separation_at_contact_deg, "°", METRIC_SOURCE_3D),
    statTile("Torso Tilt", metricsRow.torso_tilt_at_contact_deg, "°", METRIC_SOURCE_3D),
    statTile("Pelvis Tilt", metricsRow.pelvis_tilt_at_contact_deg, "°", METRIC_SOURCE_3D),
    statTile("Stride (2D)", metricsRow.stride_length_hip_widths, "hip-widths, whole clip", METRIC_SOURCE_2D),
    statTile("Lead Elbow", metricsRow.lead_elbow_angle_at_contact_deg, "°", METRIC_SOURCE_3D),
    statTile("Front Knee", metricsRow.front_knee_angle_at_contact_deg, "°", METRIC_SOURCE_3D),
  ].join("");

  const flags = metricsRow.movement_flags ?? {};
  const flagRows = [
    movementFlagRow("Lateral Sway", flags.lateral_sway),
    movementFlagRow("Rotation Pattern", flags.rotation_pattern),
    movementFlagRow("Wrist Lead", flags.wrist_lead_ms),
  ].join("");

  container.innerHTML = `
    <details class="drawer">
      <summary><span>Swing Metrics</span></summary>
      <div class="drawer-body">
        ${tiles ? `<div class="stats-row" style="grid-template-columns:repeat(auto-fit, minmax(110px, 1fr));">
          ${tiles}
        </div>
        <p class="hint">Every value is an estimate from one uncalibrated camera: 2D values are measured in the image, 3D values are monocular reconstructions. Use the original video as the source of truth.</p>` : `<p class="hint">No reliable measurements are published for this swing. Use the original video as the source of truth.</p>`}
        ${flagRows ? `<h3 style="margin-bottom:4px;">Movement Patterns</h3>${flagRows}` : ""}
      </div>
    </details>
  `;
}
