# Git history remediation plan — security remediation, not PR10

Date: 2026-10-14. This is an evidence record and proposed plan, not authorization to execute cleanup. No staging, commit, push, ref/index change, history rewrite, deployment, migration, cloud access, invitation mutation by Codex, or pose3d/checkpoint edit was performed. The orchestrator separately reports completing the authorized local invitation revocation described below. Existing uncommitted work is preserved. PR10 has not started.

## Invitation: Task A complete — revocation verified by orchestrator-run read-only queries

The earlier Docker-down gate was resolved when the user started Docker Desktop and the local Supabase stack. Codex subsequently confirmed `supabase_db_softball_analysis` healthy and `public.guardian_invites` present; maximum installed migration version was `00062`. No cloud access occurred.

### Read-only identification evidence

At **2026-10-15 00:24:50 UTC**, SELECTs in a repeatable-read, read-only transaction ending in ROLLBACK identified exactly one candidate in the 2026-10-12 21:30–22:30 UTC window:

| Field | Observed value |
| --- | --- |
| Invite ID prefix | `053848d3` |
| Player ID prefix | `25b57849` |
| Creating user prefix | `9cd07675` |
| Relationship | parent |
| Created UTC | 2026-10-12 21:56:14.427711 |
| Expires UTC | 2026-10-19 21:56:14.427711 |
| Used / revoked | false / false |
| Usable at before-snapshot | true |
| Player invite count: total / usable | 1 / 1 |
| Entire table count: total / usable | 1 / 1 |
| Creating user has coach_team_access for player team | true |
| Team player count | 1 |

Identification was UNAMBIGUOUS under the requested metadata rule: exactly one candidate, also the player's only usable invitation. No token comparison or token/hash output occurred. Because the entire table contained this single row, its created_at above also establishes the before-snapshot max(created_at); there were zero other invite rows. The player_guardians count was not queried in that before-snapshot.

### Authorized revocation performed by the orchestrator

The orchestrator reports completing revocation at approximately **2026-10-15 00:26 UTC** on the Android emulator under the owning coach's existing signed-in session, without a new sign-in or JWT minting. Workflow: legacy player page > More > Manage Player > Parents; the page showed one unused invite expiring October 19; select Cancel pending invites, confirm Cancel the pending invite?, then Cancel invites. The app responded **Invite cancelled.** and removed the pending-invite line. The orchestrator identifies this existing workflow as invoking `revoke_guardian_invites(p_player_id)` under the coach JWT (`coach/player.html:782`).

Migration 00045 defines that RPC to revoke all unused, unrevoked, unexpired invites for the player and requires a non-anonymous authenticated coach for the player's team. The before-snapshot established exactly one eligible row. Codex did not invoke this RPC or any database mutation. **UI revocation action: complete, as reported by the orchestrator.**

### Post-revocation read-only verification — complete

After Codex's Docker pipe access was denied, the orchestrator ran the same local-only verification from its own shell using `docker exec supabase_db_softball_analysis psql`, BEGIN READ ONLY, SELECTs and ROLLBACK. The following results are attributed to that **orchestrator-run read-only verification**, not a successful Codex database connection:

| Check | Verified result |
| --- | --- |
| Invite ID prefix | `053848d3` |
| revoked_at IS NOT NULL | true |
| revoked_at UTC | 2026-10-15 00:26:32.651202 |
| Used | false (used_at remains null) |
| Usable | false |
| Table total / usable | 1 / 0; before 1 / 1 |
| Player `25b57849` invites total / usable | 1 / 0; before 1 / 1 |
| Table max(created_at) UTC | 2026-10-12 21:56:14.427711; unchanged |
| Other invite rows | 0; the verified candidate is the table's only row |
| player_guardians count for this player | 0 |

**Task A complete.** The single exposed invitation is revoked and unused; the token is now inert. Total invite counts and max(created_at) are unchanged, with no new invite rows present and no other invitation rows to affect. Usable counts decreased from 1 to 0 for both the table and the candidate player. The unused invite and zero current guardian rows support the orchestrator's conclusion that this invite was never redeemed. No pre-revocation guardian-count baseline or full mutation audit was captured; these snapshot results do not claim a historical audit of unrelated guardian additions/deletions. No further revocation is needed.

### Scope and residual exposure

The local row and expiry are now established by the before-snapshot. The orchestrator's first-hand session context places the emulator on LOCAL Supabase; the native WebView origin was `https://localhost` with path `/family.html` (secret-bearing query omitted), consistent with the Capacitor note and invite builder. **INFERENCE:** the token belongs only to this local stack, reachable on the development machine LAN while running, rather than to the cloud project. Cloud absence remains unverified; no cloud query was made.

The original image containing the now-revoked token remains in public Git history until the separately approved rewrite. The orchestrator-run read-only verification confirms persisted revocation; the token is now inert under the application workflow. Revocation does not remove screenshot identity/coaching content, downloaded copies, caches or Git objects. No token redemption, authentication, service-role/SQL mutation or cloud access is authorized by this verification step.

## Observed Git exposure

- HEAD and the only local branch, master: `a0dd18f52c33f9bb473500ade00caeb310cae71a`.
- Its single parent: `022f1fec96f3e554a508cdb3d932e73e83089319`.
- `git branch -r --contains a0dd18f` lists origin/master and origin/HEAD. Both remote-tracking refs resolve to the same tip. The origin/master reflog also includes it. The live master verification below confirms publication; downloads remain unverified.
- **Confirmed published on the public remote master:** On 2026-10-14, the orchestrator's unsandboxed shell ran read-only `git ls-remote origin refs/heads/master` and received `a0dd18f52c33f9bb473500ade00caeb310cae71a`, matching local master and origin/master. Origin is the PUBLIC GitHub repository `jonmcurry/player-scouting-report`. This supplied verification supersedes the earlier sandbox proxy failure. Follow-up evidence supplied by the orchestrator on 2026-10-14: full read-only `git ls-remote origin` advertised exactly two refs, HEAD and refs/heads/master, both at `a0dd18f52c33f9bb473500ade00caeb310cae71a`. No other branches, tags or refs/pull/* entries were advertised. The orchestrator confirms engine-baseline-1.0.0 is local-only and was never pushed. Absence from this advertisement does not establish absence of hidden server refs or cached direct-SHA views. Forks, caches and collaborators' clones remain unverified. GitHub caches, forks, clones and anyone who fetched since publication may retain originals regardless of a rewrite. No fetch or push was performed in this task.
- `git for-each-ref --contains a0dd18f` lists only master, origin/master and origin/HEAD. No containing tags, other local branches or stash ref were found. `git worktree list --porcelain` reports one worktree, this repository on master at the exposed tip. Three reflog entries across all local reflogs directly reference the tip.
- The annotated engine-baseline-1.0.0 tag object is `47ac6ef85cdfca186c23a0ebcc644c4bf4b5e3ae`; it peels to required commit `f79b09e63092e87efd1250c3b263d29086d81a79`, with scripts/pose3d tree `766f4fbc64620d428da428e59b144554ca2f2a7b`. It is an ancestor of the exposed tip, not a descendant, and does not contain that commit.
- `git rev-list --all --objects` contains all 14 original blob IDs. A full recursive tree enumeration of all 138 commits reachable from local refs found each original blob only once, at its inventory path in a0dd18f. No identical original blob appears at another path or another ref-reachable commit. This does not inventory unreachable objects, external clones or remote-only refs.
- Screenshot paths are generic UI names; none of the 14 inventory filenames or directories reveals a real child name. Contents have privacy-sensitive categories documented below; no original image was rendered or OCR-transcribed during this task.

## Blob and index inventory

All original bytes match the existing inventory's original SHA-256; all working-tree bytes match its sanitized SHA-256. The table uses Git blob SHA-1 IDs, not the inventory's SHA-256 file digests. Every screenshot index entry is mode 100644, stage 0, and equals the original blob. No staged diff exists, but the current index contains all 14 ORIGINAL blobs. The index is a GC root: `git gc --prune=now` cannot drop those blobs while the index references them. The approval-gated index transition below is mandatory before reachability verification or GC. Inventory categories are prior reviewed evidence, not a fresh visual assessment. All 14 require privacy treatment; the error screenshot is classified as diagnostic/device metadata rather than a confirmed identity/token disclosure.

| Path | Original = index blob | Sanitized working-tree blob | Inventory sensitivity |
| --- | --- | --- | --- |
| `screenshots/at-bat-report/01-top-video.png` | `3c1dc337f689b808e30e123e952cd3f6c172b292` | `204ec2b0b90d8761b256b7910ed7a599d53ae843` | player/team identity; clip timing; individual coaching text; device status bar |
| `screenshots/at-bat-report/02-findings.png` | `182be8a94a487b781d3fd057386f6c61d710bc15` | `ae406f60bf15bbca89d86cec2af9e7fb37f8f5ba` | individual coaching text; selected drill; device status bar |
| `screenshots/home/00-load-error-edge-functions-down.png` | `bac443ad209f876ca61fe0ae26a41bede4c28c46` | `e17d697bf8a1dfd1ef3eab8960b93885bd265145` | runtime diagnostic text; device status bar |
| `screenshots/home/01-home.png` | `cdcd23c8adbb92e2eacd976b96f34b0cec57743a` | `2169b72d5c3f840ba6e3958e94f9a9a20e88f208` | player/team identity; roster attributes; activity and dates; device status bar |
| `screenshots/home/02-invite-parent.png` | `2788347dcd54f932d37419d664c059eb4f27203c` | `1048b4e00c33d2e508d426e657af04965982722d` | player/team identity; recipient identity; potentially active invitation URL/token; background activity; device status bar |
| `screenshots/home/03-add-import-players.png` | `8411d1e15d521669a1bbfca8e83593e252dca137` | `3d955b1af3e1d938b8e14a224f1a0c77115cff13` | player/team identity; roster attributes; device status bar |
| `screenshots/home/04-team-recent-activity.png` | `5ca1d04a2ac9dff4b8ed991acf5f746cd722347a` | `184448bd36765f50fbed2e7de4f1b7aba2103604` | player/team identity; roster attributes; activity and dates; device status bar |
| `screenshots/player/01-open-player-from-team.png` | `f971b61c76003dc192fe568d8efa684967ce50d4` | `78673556005df810e07090bcc7bc3058273ebf3b` | player identity and avatar initials; performance/status; activity; device status bar |
| `screenshots/player/02-player-scrolled.png` | `ec56e53d9ab3ea395bc49d06552f20fd7061bf02` | `7ec8d6da928331a28b07bd0b1ab7d13d0632b0f8` | player identity and avatar initials; performance/status; activity and dates; device status bar |
| `screenshots/progress/01-progress.png` | `4e019dbe2129386775289a668f19e4126e859a53` | `a46e56fca72b34b3ae88270c4fd39c5b5e264549` | player identity; progress/status; device status bar |
| `screenshots/record/01-record-sheet.png` | `7e06b08d9a7d37af10aaf82423a94f20683f7947` | `8a6ed16b066d03e3fd56367481a6c61687534aa0` | background individual coaching text; device status bar |
| `screenshots/record/02-how-to-film.png` | `15eff2e756a6fec9a701540d0adc1bcf668c7d44` | `620502cfb98f03cbe47f0a7b228384d2899134bd` | background individual coaching text; device status bar |
| `screenshots/record/03-how-to-film-scrolled.png` | `37496ec1b9f99e7dacf89d678213ddc8882629c2` | `ec19c32d5e3b59cf573764e481bcceeb80526663` | background individual coaching text; device status bar |
| `screenshots/settings/01-settings.png` | `758d286def7c35ea474cb2287a0ba90640a5bc72` | `291a86a37a8f6885728c257c0c2850c59d86ad03` | player identity; background progress/status; notification preference; device status bar |

## Options (proposals only)

| Option | Eliminates | Leaves behind | Push and collaboration effects |
| --- | --- | --- | --- |
| Forward commit with reviewed sanitized bytes and exact-hash allowlist | Sensitive images in the new tip and ordinary future checkout | Original objects in a0dd18f, its ancestors/descendant traversal, refs, reflogs, caches and clones; token lifecycle unchanged | Normal fast-forward push if remote has not diverged; old branches/tags/worktrees remain valid. Baseline unchanged. |
| Forward removal of screenshots/ plus gitignore | Tracked screenshots in future tips; reduces accidental new additions | Same historical exposure; gitignore alone never untracks existing entries | Normal commit/push; update scoped allowlist/docs as needed. No historical erasure. |
| Replace only exposed tip with an equivalent sanitized commit retaining its exact parent | Original images from the rewritten master ancestry, provided no other ref retains old tip | Old index/remote-tracking refs/reflogs, backups, caches and clones until separately handled | Confirmed public publication means tip replacement REQUIRES a separately approved, coordinated force-with-lease push of master with expected old SHA a0dd18f52c33f9bb473500ade00caeb310cae71a. Collaborators must avoid merging old history back. |
| Selective filter-repo path removal or strip-blobs-with-ids; BFG alternative | Selected paths or exact original blobs across affected histories | Any missed aliases/blobs, protected refs, remote caches, external copies, backups | Rewrites affected commits and descendants; published affected refs require coordinated replacement. Broad invocation can change unrelated history/tags and is not recommended here. BFG tip protection and tool defaults need explicit review. |
| GitHub support cache/PR-reference cleanup plus collaborator cleanup | Potential server-retained views/refs after removal, to the extent supported | Forks, downloaded originals and third-party archives may remain | Separate owner-authorized support request; not a substitute for changing reachable history. Never include tokens or original images in support tickets. |
| Revoke the one exposed invitation or verify it already unusable | Future use of that specific invitation | Identity/coaching disclosure, Git objects, and any access already granted | No Git rewrite; authenticated local workflow only. Creating a replacement alone does not revoke the original. |

A forward commit does not erase earlier objects: its parent still leads to a0dd18f and the original tree/blob IDs. Deleting a path at HEAD or adding gitignore changes only later trees. Revocation similarly cannot erase personal information in screenshots.

## Recommended strategy and protected history

Publication on public remote master is confirmed by the orchestrator. Prefer a narrowly scoped replacement of ONLY a0dd18f with a sanitized equivalent retaining parent 022f1fec96f3e554a508cdb3d932e73e83089319. This therefore REQUIRES a separately approved force-with-lease push of master, explicitly expecting old SHA a0dd18f52c33f9bb473500ade00caeb310cae71a. Recheck immediately before execution and stop if master has advanced. GitHub caches, forks, clones and anyone who fetched since publication may retain originals regardless of the rewrite. Retain all non-screenshot changes in the tip. Keep the reviewed sanitized images and allowlist rather than removing useful redacted references, unless the user chooses removal. Do not undertake a repository-wide rewrite for blobs found only in the tip.

Historical option, no longer applicable: an unpushed-tip-only soft-reset/recommit path without remote replacement was considered before live verification. Confirmed publication rules out that scenario. A narrowly scoped amend-style replacement remains smaller than filter-repo/BFG, but now also requires the approved remote force-with-lease procedure. All such ref/index changes remain prohibited in this task.

Replacing one tip with the exact same parent does not rewrite any ancestors. Therefore PR1-PR8 committed work and the protected baseline commit/tree remain unchanged. The annotated baseline tag must remain byte-for-byte the same object and peel to f79b09e63092e87efd1250c3b263d29086d81a79 with pose3d tree 766f4fbc64620d428da428e59b144554ca2f2a7b. No tag move, broad ref rewrite, checkpoint change or pose3d edit is needed or authorized. Preserve PR9's existing uncommitted package/NEXT_STEPS changes, 00065 migration, evidence-persistence documentation and tests separately; do not accidentally fold them into replacement history.

## Approval-gated execution outline — not executed

1. Obtain explicit approval for backup destination/access/retention. Before any rewrite, create and verify a private Git backup bundle of the relevant refs and an independent byte-preserving backup of every modified/untracked working file, including sanitized screenshots, inventory, scripts, docs and PR9 files. A bundle does not contain uncommitted work, index state or all reflog-only objects. Record ref/tag IDs, index hash, changed-file hashes and baseline tree separately. Backups containing original history are sensitive; never upload them publicly. Avoid stash: it changes refs/index/worktree and can create another sensitive history root. Keep rollback copies outside the future purge scope.
2. Approve the exact replacement commit scope, explicit staging/index/ref changes and commit creation separately. Prepare in an isolated disposable clone only after approval; verify no unrelated changes are included and compare all non-screenshot tip paths and parent IDs. Preserve the current working tree and restore by verified file hashes if relocation becomes necessary. Do not use reset --hard or clean.
3. Immediately before the approved push, re-run full read-only `git ls-remote origin`. Require exactly HEAD and refs/heads/master at `a0dd18f52c33f9bb473500ade00caeb310cae71a`. Stop and reassess if either moves, any ref other than HEAD/master appears, or any additional ref containing a0dd18f is discovered; never overwrite intervening work. Advertisement alone does not prove ancestry for a different ref tip: any unexpected ref requires investigation before proceeding. Obtain separate approval for the required force-with-lease push of rewritten master with expected old SHA `a0dd18f52c33f9bb473500ade00caeb310cae71a`, plus any branch-protection adjustment if actually needed. No broad force push, mirror push, tag deletion or baseline tag update. Coordinate all collaborators, including Codex/Claude worktrees and clones on other machines such as the Mac mentioned in NEXT_STEPS. Existing clones must NOT run `git pull`: a default merge can reintroduce a0dd18f. Prefer deleting the old clone and re-cloning only after approved backups and confirmation that no local work or local-only baseline tag is lost. Otherwise, after separate approval and preservation of local work, run `git fetch origin`, explicitly reset local master to origin/master, and prune old refs/reflogs under the approved cleanup scope. Do not merge old branches back. These are future collaborator instructions, not actions authorized or performed here.
4. Transition the main worktree index only after the approved sanitized replacement commit exists and is available locally. With master checked out, obtain explicit approval to point master at that replacement and refresh the index to its tree WITHOUT touching working-tree files, for example `git reset --mixed REPLACEMENT` (REPLACEMENT means the reviewed replacement commit SHA). This changes both refs and index, requires explicit approval, and must never use --hard. Verify all pre-existing working-file hashes and the protected local baseline tag remain unchanged. Require `git ls-files -s screenshots/` to show only the 14 sanitized blob IDs in the inventory table, with no original IDs, before any reachability checks or GC. Updating a disposable clone alone does not update this main worktree index.
5. Obtain separate approval for local ref/reflog cleanup, backup retention/destruction, and garbage collection. Enumerate all refs, stash, worktrees, index and reflogs first; remove old-tip reachability only in the specifically approved places. Original refs/backup refs or a stale origin/master keep blobs live. Verify `git rev-list --all --objects` contains none of the 14 original IDs and additionally inspect `git rev-list --all --reflog --objects` and index IDs. Absence from --all alone does not prove physical deletion.
6. Only after the sanitized-index check above, rollback/retention approval and with no concurrent Git writers, consider reflog expiration and `git gc --prune=now`. These discard recovery information and may affect unrelated recovery history; authorize the exact scope before running. Check original object availability afterward without printing contents. A retained bundle intentionally retains exposure and must be secured until separately approved destruction.
7. After approved remote replacement, use a fresh independent clone to recheck advertised branches/tags, all original blob IDs, sanitized hashes and the media guard. Since engine-baseline-1.0.0 was never pushed, verify its exact tag object and peeled commit/tree in the preserved local repository/backup; do not expect that tag in a fresh remote clone or push it as part of remediation. A fresh clone proves only fetched/advertised reachability, not server caches, hidden PR refs, forks or other clones. Request owner-authorized GitHub support help for residual cached views/PR refs if needed; document unresolved retention rather than claim global erasure.
8. Task A is complete: the orchestrator performed the authorized coach-session revocation and confirmed it through local read-only verification. Invite 053848d3 is revoked and unused; table/player counts are each 1 total / 0 usable, and guardian count is 0. Do not repeat revocation. Cloud access, broad invite revocation and direct SQL/service-role updates remain unauthorized.

## Validation and remaining gates

The 14-image structural/hash/redaction verifier passed. git diff --check passed. Direct Git queries confirmed baseline ancestry, peeled tag and tree. The Node media guard and Node baseline guard could not complete their Git subprocess verification in this execution environment; neither is a pass. Independent hash comparison and source inspection establish that the working allowlist approves only sanitized screenshot SHA-256 values, while all 14 indexed originals differ and must remain rejected as ASSET_CONTENT_CHANGED_IN_INDEX when the guard can execute normally. The media guard checks the index and working files, not historical reachability. Do not weaken it or approve original hashes.

Only this plan is a new deliverable; no product behavior or version changed, so no changelog/version bump or rendered UI QA is applicable. The orchestrator reports completed independent orchestrated review, recorded below. Its findings have been incorporated into this plan; the review does not authorize execution. All release/cleanup approvals remain separate. Publication on public remote master is confirmed by the orchestrator. The user subsequently started the local stack; identification succeeded, the orchestrator completed UI revocation, and orchestrator-run read-only verification confirmed the revoked status and after-counts despite Codex Docker pipe denial. Full advertised remote refs are verified as described above. Post-revocation invitation status/counts and the zero guardian count are verified by the orchestrator. Hidden server refs/caches and all external copies remain unverified.

### Independent review and reconciliation

The earlier local wrapper attempt stopped before review when its old review-artifact cleanup received Access denied. Subsequently, the orchestrator reports that Gemini/AGY independent review with `gemini-3.8-flash-high` completed via `Invoke-OrchestratedQA.ps1 -SkipTests -Paths <plan>` from its own environment: **0 BLOCKING, 3 NON-BLOCKING, 2 QUESTION / JUDGMENT CALL**. The review artifact is under `.git/gemini-review/`; its exact filename was not supplied. This records the orchestrator's reported completed review, not a new local review run or a claim that Gemini re-reviewed these follow-up edits.

The orchestrator verified all three NON-BLOCKING findings as valid. They are reconciled here: full remote-ref enumeration and a fresh pre-push stop gate; explicit approval-gated main-worktree index transition to sanitized blobs before verification/GC; and collaborator instructions prohibiting git pull and covering agent worktrees and other machines. No BLOCKING findings were reported. No release, cleanup or deployment was attempted.

The review raised two judgment calls; current status follows:

- **GitHub Support:** Recommend filing a separately authorized request after the force-push to purge the unreferenced commit/cached views. Direct-SHA URLs can remain viewable until GitHub server-side GC; rewriting master does not guarantee erasure. Include only non-sensitive repository/commit identifiers, never invitation tokens or original images. Support action cannot guarantee removal from forks, clones or downloaded copies.
- **Invitation ordering (subsequently acted on):** Gemini agreed the earlier deferral was consistent with the no-start/no-cloud rules. The user later started the local stack, Codex identified a single usable invite, and the orchestrator reports completing the authorized coach-session revocation. The orchestrator subsequently completed local read-only verification as documented above; Task A is complete. If the token were ever found in the cloud database, reassess with the user; this does not authorize cloud access or mutation. The prior review is not a claim of Gemini review of these later events.

Final deterministic preservation audit: all 23 pre-existing modified/untracked files match their before-task SHA-256 values; the Git index file hash is unchanged. All 14 working allowlist hashes equal sanitized inventory hashes and differ from original hashes. Only the plan was added as a deliverable (plus ignored metadata-only audit scratch under .agent-tmp). No original images, secrets or token hashes were written to that scratch.
