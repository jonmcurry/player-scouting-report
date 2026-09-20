// Shared BarrelTrace application shell. Phase 1A changes presentation and
// navigation only; routes and the existing page workflows remain unchanged.
import { supabase, escapeHtml } from "../shared.js";
import { icon, iconButton, listRow, openActionSheet, openBottomSheet, openOverflowMenu } from "./ui.js";
import { bottomNavState } from "./shellState.js";
export { bottomNavState } from "./shellState.js";

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

function appBarIdentity({ backHref, backLabel, badge = "", title, subtitle = "", switchable = false, overflow = false }) {
  return `<div class="app-bar-left">
    <a href="${escapeHtml(backHref)}" class="app-bar-back" aria-label="${escapeHtml(backLabel)}">${icon("chevron-left", { size: 24 })}</a>
    ${badge}
    <div class="app-bar-titles">
      <div class="app-bar-title-row"><h1>${escapeHtml(title)}</h1>${switchable ? iconButton("chevron-down", "Switch player", { className: "app-bar-caret", attrs: 'id="playerSwitcherToggle"' }) : ""}</div>
      ${subtitle ? `<div class="app-bar-subtitle">${escapeHtml(subtitle)}</div>` : ""}
    </div>
  </div>${overflow ? iconButton("ellipsis-vertical", "More options", { className: "app-bar-overflow", attrs: 'id="appBarOverflow"' }) : ""}`;
}

/** 56dp team identity variant. Confirmed-count data remains loaded elsewhere but is not shell chrome. */
export function renderTeamAppBar(container, { teamName, overflowItems = [] }) {
  container.innerHTML = `
    ${appBarIdentity({ backHref: "./index.html", backLabel: "Back to My Teams", title: teamName, subtitle: "Team", overflow: overflowItems.length > 0 })}
  `;
  const trigger = container.querySelector("#appBarOverflow");
  if (trigger) trigger.addEventListener("click", () => openOverflowMenu({ title: teamName, items: overflowItems, anchor: trigger }));
}

/**
 * @param {{ player: {name:string, jersey_number:number|string, slug:string},
 *   teamName: string, teamSlug: string,
 *   roster: Array<{name:string, jersey_number:number|string, slug:string, scoredCount:number, reviewedCount:number}>,
 *   confirmedCount: number, totalCount: number }} opts
 */
export function renderPlayerAppBar(container, { player, teamName, teamSlug, roster, confirmedCount, totalCount }) {
  container.innerHTML = appBarIdentity({
    backHref: `./team.html?team=${encodeURIComponent(teamSlug)}`,
    backLabel: `Back to ${teamName}`,
    badge: `<div class="jersey-badge sm">${escapeHtml(player.jersey_number)}</div>`,
    title: player.name,
    subtitle: teamName,
    switchable: true,
    overflow: true,
  });
  const toggle = container.querySelector("#playerSwitcherToggle");
  toggle.addEventListener("click", () => {
    const rows = roster.map((p) => listRow({
      href: `./player.html?team=${encodeURIComponent(teamSlug)}&player=${encodeURIComponent(p.slug)}`,
      leading: `<span class="jersey-badge sm">${escapeHtml(p.jersey_number)}</span>`,
      title: p.name,
      supporting: p.slug === player.slug ? "Current player" : "",
      trailing: p.slug === player.slug ? icon("check", { size: 20 }) : icon("chevron-right", { size: 20 }),
    })).join("");
    openBottomSheet({ title: "Switch player", bodyHtml: `<div class="bt-list">${rows}</div>` });
  });
  const overflow = container.querySelector("#appBarOverflow");
  const openManage = () => {
    const details = document.getElementById("managePlayer");
    if (details) { details.open = true; details.scrollIntoView({ behavior: "smooth" }); }
  };
  overflow.addEventListener("click", () => openOverflowMenu({
    title: player.name,
    anchor: overflow,
    items: [
      { label: "Share link", icon: "link", onSelect: openManage },
      { label: "Player context", icon: "user-round", onSelect: openManage },
      { label: "Manage player", icon: "ellipsis-vertical", onSelect: openManage },
    ],
  }));
}

/** Title-only drill-in foundation. Screens adopt it in Phase 1B. */
export function renderDrillInAppBar(container, { title, backHref, backLabel = "Back", overflowItems = [] }) {
  container.innerHTML = appBarIdentity({ backHref, backLabel, title, overflow: overflowItems.length > 0 });
  const trigger = container.querySelector("#appBarOverflow");
  if (trigger) trigger.addEventListener("click", () => openOverflowMenu({ title, items: overflowItems, anchor: trigger }));
}

/**
 * @param {{ teamSlug: string, activeTab: "roster"|"report"|"logab",
 *   reportHref: string, logAbHref: string, onLogAbClick?: () => void }} opts
 */
function playerRoute(teamSlug, player, target) {
  const base = `team=${encodeURIComponent(teamSlug)}&player=${encodeURIComponent(player.slug)}`;
  return target === "atbat" ? `./player.html?${base}&openLog=1` : `./session.html?${base}&start=1`;
}

function choosePlayer(sheet, { roster, teamSlug, action }) {
  const body = sheet.querySelector(".bt-sheet-body");
  sheet.querySelector(".bt-sheet-header h2").textContent = "Choose a player";
  body.innerHTML = `<div class="bt-list">${roster.length ? roster.map((player) => listRow({
    href: playerRoute(teamSlug, player, action),
    leading: `<span class="jersey-badge sm">${escapeHtml(player.jersey_number)}</span>`,
    title: player.name,
    trailing: icon("chevron-right", { size: 20 }),
  })).join("") : `<p class="bt-supporting">Add a player before logging an at-bat or practice.</p>`}</div>`;
}

/** Interim Phase-1 nav: Team / + / Player. No review-queue destination is invented here. */
export function renderBottomNav(container, {
  teamSlug, activeTab, reportHref = null, currentPlayer = null, roster = [], onLogAbClick = null,
}) {
  const playerHref = reportHref && reportHref !== "#" ? reportHref : null;
  const items = bottomNavState({ teamSlug, activeTab, playerHref });
  container.innerHTML = `
    ${items.map((item) => item.key === "add"
      ? `<button type="button" class="bottom-nav-add" id="navAdd" aria-label="Add">${icon("plus", { size: 24 })}<span>Add</span></button>`
      : item.hidden ? "" : `<a href="${item.href}" data-active="${item.active}">${icon(item.icon, { size: 22 })}<span>${item.label}</span></a>`).join("")}
  `;
  container.querySelector("#navAdd").addEventListener("click", () => {
    const needsPlayer = (action, sheet) => {
      if (currentPlayer) {
        sheet.remove();
        sheet.whenClosed.then(() => {
          if (action === "atbat" && onLogAbClick) onLogAbClick();
          else location.href = playerRoute(teamSlug, currentPlayer, action);
        });
      } else choosePlayer(sheet, { roster, teamSlug, action });
    };
    openActionSheet({
      title: "Add",
      actions: [
        { label: "Log at-bat", icon: "plus", supporting: currentPlayer ? currentPlayer.name : "Choose a player", keepOpen: true, onSelect: (sheet) => needsPlayer("atbat", sheet) },
        { label: "Start practice", icon: "repeat", supporting: currentPlayer ? currentPlayer.name : "Choose a player", keepOpen: true, onSelect: (sheet) => needsPlayer("practice", sheet) },
        { label: "Add player", icon: "user-round", supporting: "Add to this team", href: `./team.html?team=${encodeURIComponent(teamSlug)}&addPlayer=1` },
      ],
    });
  });
}
