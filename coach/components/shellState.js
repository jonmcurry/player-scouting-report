// Pure shell decisions, separated from Supabase/DOM so navigation contracts
// can be unit-tested without a browser.
export const PLAYER_TABS = Object.freeze([
  { key: "report", label: "Overview", page: "player" },
  { key: "development", label: "Development", page: "development" },
  { key: "compare", label: "Compare", page: "compare" },
  { key: "practice", label: "Practice", page: "session" },
]);

export function bottomNavState({ teamSlug, activeTab, playerHref = null }) {
  return [
    { key: "team", label: "Team", icon: "users", href: `./team.html?team=${encodeURIComponent(teamSlug)}`, active: activeTab === "roster" || activeTab === "team" },
    { key: "add", label: "Add", icon: "plus", href: null, active: false },
    { key: "review", label: "Review", icon: "eye", href: `./queue.html?team=${encodeURIComponent(teamSlug)}`, active: activeTab === "review" || activeTab === "queue", hidden: false },
  ];
}
