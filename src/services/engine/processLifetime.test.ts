import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { mkdirSync, existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { superviseProcess, killProcessTree } from "./processLifetime.js";

test("taskkill exit 128 succeeds even before the child exit event arrives", async () => {
  const child = { pid: 123, exitCode: null } as ChildProcess;
  await killProcessTree(child, "win32", pid => {
    assert.equal(pid, child.pid);
    const killer = new EventEmitter() as ChildProcess;
    queueMicrotask(() => killer.emit("close", 128));
    return killer;
  });
});

for (const cause of ["timeout", "abort"] as const) {
  test(`dummy process tree terminates on ${cause}`, async () => {
    const directory = path.resolve(".agent-tmp", `process-lifetime-${randomUUID()}`);
    mkdirSync(directory, { recursive: true });
    const pidFile = path.join(directory, "pid.txt");
    const child = spawn(process.execPath, ["-e", `
      const {spawn} = require('node:child_process');
      const grandchild = spawn(process.execPath, ['-e', 'setTimeout(()=>{},5000)'], {stdio:'ignore'});
      require('node:fs').writeFileSync(process.argv[1], String(grandchild.pid));
      setTimeout(()=>{},5000);
    `, pidFile], { detached: process.platform !== "win32", windowsHide: true, stdio: "ignore" });
    const closed = once(child, "close");
    const controller = new AbortController();
    let cleanup = () => {};
    try {
      const deadline = Date.now() + 10000;
      while (!existsSync(pidFile) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      const grandchildPid = Number(readFileSync(pidFile, "utf8"));
      assert.ok(grandchildPid > 0);
      const started = Date.now();
      const failed = new Promise<Error>(resolve => {
        cleanup = superviseProcess(child, cause === "timeout" ? 100 : 10000, controller.signal, resolve).dispose;
      });
      if (cause === "abort") controller.abort();
      const error = await failed;
      assert.match(error.message, cause === "timeout" ? /timeout/ : /Claim lost/);
      await closed;
      assert.ok(Date.now() - started < 2500, "tree must terminate promptly, not by dummy lifetime expiry");
      // taskkill/process-group kill also terminates the child spawned by the dummy.
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.throws(() => process.kill(grandchildPid, 0));
    } finally {
      cleanup();
      if (child.exitCode === null && child.signalCode === null) await killProcessTree(child);
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
