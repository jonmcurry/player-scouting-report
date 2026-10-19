import { spawn, type ChildProcess } from "node:child_process";

export async function killProcessTree(child: ChildProcess, platform: NodeJS.Platform = process.platform,
  spawnTaskkill: (pid: number) => ChildProcess = pid => spawn("taskkill", ["/PID", String(pid), "/T", "/F"],
    { windowsHide: true, stdio: "ignore" })): Promise<void> {
  if (!child.pid) return;
  if (platform === "win32") {
    await new Promise<void>((resolve, reject) => {
      const killer = spawnTaskkill(child.pid!);
      killer.once("error", reject);
      killer.once("close", code => code === 0 || code === 128 || child.exitCode !== null ? resolve() : reject(new Error(`taskkill exited ${code}`)));
    });
  } else {
    try { process.kill(-child.pid, "SIGKILL"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
  }
}

/** Caller must spawn a detached process group on POSIX. */
export function superviseProcess(child: ChildProcess, timeoutMs: number, signal: AbortSignal,
  fail: (error: Error) => void) {
  let stopped = false;
  const stop = (error: Error) => {
    if (stopped) return;
    stopped = true;
    // 'stopped' suppresses racing output/close handlers while the tree is killed.
    void killProcessTree(child).then(() => fail(error), killError =>
      fail(new Error(`${error.message}; process tree termination failed: ${String(killError)}`)));
  };
  const timer = setTimeout(() => stop(new Error("Pipeline timeout exceeded")), timeoutMs);
  const abort = () => stop(new Error("Claim lost; pipeline abandoned"));
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  return {
    get stopped() { return stopped; },
    dispose: () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    },
  };
}
