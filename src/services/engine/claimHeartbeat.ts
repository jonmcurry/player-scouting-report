export class ClaimLostError extends Error {
  constructor() { super("Claim lost; abandoning clip without further state writes"); }
}

/** The DB adapter applies these exact equality predicates, preserving timestamp text. */
export function heartbeatUpdate(videoClipId: string, expectedClaimedAt: string, now: string) {
  if (!expectedClaimedAt) throw new Error("Missing claim timestamp");
  return { values: { claimed_at: now }, where: { id: videoClipId, status: "processing", claimed_at: expectedClaimedAt } };
}

/** Serialize heartbeat and writes so no new write begins after a lost-claim result. */
export function startClaimHeartbeat(initial: string, intervalMs: number,
  heartbeat: (expected: string) => Promise<string | null>, log: (error: unknown) => void = console.warn) {
  let expected = initial;
  let active = true;
  let lost = false;
  let tail: Promise<unknown> = Promise.resolve();
  const controller = new AbortController();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation);
    tail = result.catch(() => {});
    return result;
  };
  const check = () => { if (lost) throw new ClaimLostError(); };
  const tick = () => serialize(async () => {
    if (!active || lost) return;
    try {
      const next = await heartbeat(expected);
      if (next === null) { lost = true; active = false; controller.abort(); }
      else expected = next;
    } catch (error) { log(error); }
  });
  const timer = setInterval(() => { void tick(); }, intervalMs);
  timer.unref();
  const stop = () => { active = false; clearInterval(timer); };
  return {
    signal: controller.signal, check, tick, stop,
    get lost() { return lost; },
    write: <T>(operation: () => Promise<T>) => serialize(async () => { check(); return operation(); }),
    finish: <T>(operation: () => Promise<T>) => serialize(async () => {
      check();
      const result = await operation();
      stop();
      return result;
    }),
  };
}
