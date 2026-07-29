// Shared sticky app bar + bottom nav (ux.md Step 2) used by team.html and
// player.html - NOT index.html, which is the login/team-picker step and has
// no team/roster context yet.
import { supabase } from "../shared.js";

const LAST_PLAYER_KEY_PREFIX = "coach:lastPlayer:";

export function getLastPlayerSlug(teamSlug) {
  return sessionStorage.getItem(LAST_PLAYER_KEY_PREFIX + teamSlug);
}

export function setLastPlayerSlug(teamSlug, playerSlug) {
  sessionStorage.setItem(LAST_PLAYER_KEY_PREFIX + teamSlug, playerSlug);
}

/** Team-wide roster + "fully confirmed" progress, for the app bar's
 * confirmed pill (shown on both team.html and player.html per ux.md's Step 4
 * prototype, which keeps this pill visible on the per-player Report screen
 * too - it's whole-roster progress, not this-player-only progress) and the
 * player-switcher dropdown. A player counts as "confirmed" once she has at
 * least one scored checkpoint and none of her scored checkpoints are still
 * missing reviewed_by (no unconfirmed AI drafts left). */
export async function loadRosterWithProgress(teamId) {
  const { data: players, error } = await supabase
    .from("players")
    .select("id, name, jersey_number, slug")
    .eq("team_id", teamId)
    .order("name");
  if (error || !players || players.length === 0) return { roster: [], confirmedCount: 0, totalCount: 0 };

  // One batched query for the whole roster instead of one query per player -
  // same fix as team.html's loadPlayers(), same real N+1 this used to be.
  const { data: allScores } = await supabase
    .from("checklist_scores")
    .select("player_id, score, reviewed_by")
    .in(
      "player_id",
      players.map((p) => p.id),
    );
  const scoresByPlayer = new Map();
  for (const s of allScores ?? []) {
    if (!scoresByPlayer.has(s.player_id)) scoresByPlayer.set(s.player_id, []);
    scoresByPlayer.get(s.player_id).push(s);
  }

  let confirmedCount = 0;
  for (const p of players) {
    const scores = scoresByPlayer.get(p.id) ?? [];
    const scored = scores.filter((s) => s.score !== null);
    p.scoredCount = scored.length;
    p.reviewedCount = scored.filter((s) => s.reviewed_by).length;
    if (scored.length > 0 && scored.every((s) => s.reviewed_by)) confirmedCount += 1;
  }
  return { roster: players, confirmedCount, totalCount: players.length };
}

function confirmedPillHtml(confirmedCount, totalCount) {
  return `<span class="confirmed-pill">✓ ${confirmedCount}/${totalCount} Confirmed</span>`;
}

/** @param {{ teamName: string, confirmedCount: number, totalCount: number }} opts */
export function renderTeamAppBar(container, { teamName, confirmedCount, totalCount }) {
  container.innerHTML = `
    <div class="app-bar-left">
      <div class="jersey-badge">⚾</div>
      <div class="app-bar-titles">
        <div class="app-bar-title-row"><h1>${teamName}</h1></div>
        <div class="app-bar-subtitle">Team Roster</div>
      </div>
    </div>
    ${confirmedPillHtml(confirmedCount, totalCount)}
  `;
}

/**
 * @param {{ player: {name:string, jersey_number:number|string, slug:string},
 *   teamName: string, teamSlug: string,
 *   roster: Array<{name:string, jersey_number:number|string, slug:string, scoredCount:number, reviewedCount:number}>,
 *   confirmedCount: number, totalCount: number }} opts
 */
export function renderPlayerAppBar(container, { player, teamName, teamSlug, roster, confirmedCount, totalCount }) {
  container.innerHTML = `
    <div class="app-bar-left player-switcher">
      <div class="jersey-badge">${player.jersey_number}</div>
      <div class="app-bar-titles">
        <div class="app-bar-title-row">
          <h1>${player.name}</h1>
          <button type="button" class="app-bar-caret tap-target" id="playerSwitcherToggle" aria-label="Switch player">▾</button>
        </div>
        <div class="app-bar-subtitle">${teamName}</div>
      </div>
      <div class="player-switcher-menu" id="playerSwitcherMenu" style="display:none;"></div>
    </div>
    ${confirmedPillHtml(confirmedCount, totalCount)}
  `;

  const menu = container.querySelector("#playerSwitcherMenu");
  menu.innerHTML = roster
    .map(
      (p) => `
    <a href="./player.html?team=${teamSlug}&player=${p.slug}" data-current="${p.slug === player.slug}">
      <div class="jersey-badge sm">${p.jersey_number}</div>
      <span>${p.name}</span>
    </a>
  `,
    )
    .join("");

  const toggle = container.querySelector("#playerSwitcherToggle");
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.style.display = menu.style.display === "none" ? "block" : "none";
  });
  document.addEventListener("click", (e) => {
    if (!container.contains(e.target)) menu.style.display = "none";
  });
}

/**
 * @param {{ teamSlug: string, activeTab: "roster"|"report"|"logab",
 *   reportHref: string, logAbHref: string, onLogAbClick?: () => void }} opts
 */
export function renderBottomNav(container, { teamSlug, activeTab, reportHref, logAbHref, onLogAbClick }) {
  container.innerHTML = `
    <a href="./team.html?team=${teamSlug}" data-active="${activeTab === "roster"}">
      <span class="nav-icon">⚾</span><span>Roster</span>
    </a>
    <a href="${reportHref}" data-active="${activeTab === "report"}">
      <span class="nav-icon">📊</span><span>Report</span>
    </a>
    <a href="${logAbHref}" data-active="${activeTab === "logab"}" id="navLogAb">
      <span class="nav-fab">+</span><span>Log AB</span>
    </a>
  `;

  if (onLogAbClick) {
    container.querySelector("#navLogAb").addEventListener("click", (e) => {
      e.preventDefault();
      onLogAbClick();
    });
  }
}
