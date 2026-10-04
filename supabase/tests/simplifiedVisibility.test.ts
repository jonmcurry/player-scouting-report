import { selectVisibleClips } from "../functions/get-simplified-report/visibility.ts";

Deno.test("pending deletion stays retryable only for the authorized user", () => {
  const all = [{ id: "deleting" }, { id: "ready" }];
  const deleting = new Set(["deleting"]);
  const own = selectVisibleClips(all, all, deleting, false);
  if (own.clips.map((row) => row.id).join() !== "ready" || own.recent.map((row) => row.id).join() !== "ready"
    || own.feedClips.map((row) => row.id).join() !== "deleting,ready") throw new Error("wrong authenticated visibility");
  const shared = selectVisibleClips(all, all, deleting, true);
  if (shared.feedClips.map((row) => row.id).join() !== "ready") throw new Error("shared link exposed deleting clip");
});
