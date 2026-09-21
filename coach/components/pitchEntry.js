import { countLabel, inferCounts, nextPitchNumber, swungFromOutcome } from "./developmentLogic.js";

export function pitchCountTitle(number, pitches = []) {
  const next = { id: "__next", pitch_number: number, pitch_outcome: null };
  const row = inferCounts([...pitches.filter((p) => p.pitch_number < number), next]).find((item) => item.pitch.id === "__next");
  return `Pitch ${number} · ${countLabel(row?.balls ?? null, row?.strikes ?? null)}`;
}

export function likelyAtBatOver(pitches = []) {
  const rows = inferCounts(pitches);
  if (!rows.length) return false;
  const last = rows.at(-1);
  const outcome = last.pitch.pitch_outcome;
  if (["ball_in_play", "hit_by_pitch"].includes(outcome)) return true;
  if (outcome === "ball" && last.balls === 3) return true;
  return ["called_strike", "swinging_strike"].includes(outcome) && last.strikes === 2;
}

/** Standard outcome save. Never writes count_before_*: those columns are reserved for an explicit
 * coach "Fix count" override (see pitchPatchForCountOverride), so counts keep deriving from the
 * pitch history when an earlier outcome is corrected. */
export function pitchPatchForOutcome(outcome, zone = null) {
  return {
    pitch_outcome: outcome,
    swung: swungFromOutcome(outcome),
    ...(zone != null ? { pitch_zone: zone } : {}),
  };
}

/** Explicit coach count override. Returns {} when the chosen count equals what history already implies. */
export function pitchPatchForCountOverride(balls, strikes, derived = null) {
  if (derived && derived.balls === balls && derived.strikes === strikes) return {};
  return { count_before_balls: balls, count_before_strikes: strikes };
}

/** Meta line pieces for a pitch row, without "Take · Take" when outcome and batter action agree. */
export function pitchMetaParts(label, swung, zoneText = "") {
  const action = swung === true ? "Swing" : swung === false ? "Take" : "";
  return [label, action === label ? "" : action, zoneText].filter(Boolean);
}

export async function insertPitchCollisionSafe({ loadPitches, insertPitch, maxAttempts = 4 }) {
  let pitches = await loadPitches();
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const number = nextPitchNumber(pitches);
    try { return await insertPitch(number); }
    catch (error) {
      if (String(error?.code) !== "23505" || attempt === maxAttempts - 1) throw error;
      pitches = await loadPitches();
    }
  }
  throw new Error("Couldn't allocate a pitch number.");
}

export function nextAtBatNumber(entries = [], { date, opponent } = {}) {
  return entries.filter((entry) => entry.date === date && String(entry.opponent ?? "").trim().toLowerCase() === String(opponent ?? "").trim().toLowerCase())
    .reduce((max, entry) => Math.max(max, Number(entry.ab) || 0), 0) + 1;
}
