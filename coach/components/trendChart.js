// Small, dependency-free inline-SVG sparkline for a checkpoint's real score
// history (checklist_score_history - already trigger-populated on every
// score change, see 00002_coach_app.sql's log_checklist_score_history()).
// No charting library added - this app has no existing chart anywhere, and
// a handful of 1-3 integer points per checkpoint doesn't need one.

const WIDTH = 160;
const HEIGHT = 36;
const PAD = 6;

function scoreColor(score) {
  if (score === 1) return "var(--status-critical)";
  if (score === 2) return "var(--status-warning)";
  return "var(--status-good)";
}

/**
 * @param {HTMLElement} container
 * @param {Array<{changed_at: string, score: number}>} points - real history
 *   rows, oldest first. Caller should only call this with 2+ points - a
 *   single point isn't a trend.
 */
export function renderTrendChart(container, points) {
  if (!points || points.length < 2) {
    container.innerHTML = "";
    return;
  }

  const usableWidth = WIDTH - PAD * 2;
  const usableHeight = HEIGHT - PAD * 2;
  const stepX = usableWidth / (points.length - 1);
  // Score is always 1-3 (checklist_scores.score check constraint) - fixed
  // axis, not auto-scaled to the data, so a flat line at "3" and a flat
  // line at "1" are visually distinguishable from each other.
  const yFor = (score) => PAD + usableHeight * (1 - (score - 1) / 2);

  const coords = points.map((p, i) => [PAD + i * stepX, yFor(p.score)]);
  const linePath = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

  const dots = coords
    .map(([x, y], i) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="${scoreColor(points[i].score)}" />`)
    .join("");

  const first = points[0];
  const last = points[points.length - 1];

  container.innerHTML = `
    <svg class="trend-sparkline" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img"
         aria-label="Score trend: ${first.score} to ${last.score} across ${points.length} scores">
      <path d="${linePath}" fill="none" stroke="var(--text-muted)" stroke-width="1.5" />
      ${dots}
    </svg>
  `;
}
