# Windows history cleanup plan (Step 4C): removal of locally retained sensitive screenshot objects

Date: 2026-10-16. **Plan only. Owner approval required before any step below runs.** While preparing it, nothing was
expired, pruned, deleted, rewritten or re-pointed. Every observation came from read-only commands, or from rehearsals in
synthetic throwaway repositories that contain no project data. This document contains no image content, invitation token,
credential, or e-mail address. Scope: the Windows machine only. The Mac clone is out of scope and still un-inventoried.

| Symbol | Value |
|---|---|
| `R` (sanitized master, GitHub + local) | `e961f34b355825ced08b0ad2e9344204ef6fccdd` |
| `X` (exposed commit) | `a0dd18f52c33f9bb473500ade00caeb310cae71a` |
| `P` (shared parent) | `022f1fec96f3e554a508cdb3d932e73e83089319` |
| Baseline tag | `engine-baseline-1.0.0` → tag object `47ac6ef8…` → commit `f79b09e…`; `scripts/pose3d` tree `766f4fbc…` |
| Original screenshot blob IDs | 14, saved in `C:\Users\jonmc\AppData\Local\HitterLoopRecoveryPreflight\step4b\orig-blobs.txt` |

## 1. Verified current state (2026-10-16, read-only)

- **GitHub** advertises exactly `HEAD` and `refs/heads/master` = `R`. There are 0 pull requests (all states), 0 forks, and no LFS.
- **Local refs:**
  - `master` = `origin/master` = `origin/HEAD` = `R`, and `HEAD` → `refs/heads/master`;
  - the tag is unchanged;
  - there are no other refs, no stash entries, and one worktree.
- **Index/status:** the index tree equals `R`'s tree. Status shows 2 modified (`NEXT_STEPS.md`, `package.json`), 0 staged, and 7 untracked
  work files. This plan document is now an 8th untracked file, and every status assertion below expects it.
- **The 9 work files** are byte-identical to the image-free backup `…\step4b\work\` (sha256 manifest `work-manifest.sha256`, verified in Step 4B).

### 1.1 Where `X` and the 14 original blobs are still held

| Holder | Detail |
|---|---|
| Main repo reflogs | `HEAD@{1}`, `refs/heads/master@{1}`, `refs/remotes/origin/master@{1}` have new-value `X`, and each `@{0}` has old-value `X`. That's 6 lines in 3 files: HEAD lines 128–129/129, master 125–126/126, origin/master 112–113/113. |
| Main repo `ORIG_HEAD` | = `X`. A synthetic rehearsal showed that `ORIG_HEAD` alone does **not** stop gc from pruning, but it would be left dangling, so it is removed explicitly. |
| Main repo object DB | `X`, its tree, and 14/14 original blobs, in packs. There are no `.keep`/`.promisor` packs, so a repack can drop them. There are no alternates in any repo. |
| Isolated Step 2 clone `…\step2-20261015\isolated-clone` | Its `master`, `origin/master` and `origin/HEAD` = `X`, holding 14/14 originals. |
| Encrypted archive `…\backup-20261015-111919\hitterloop-complete.7z` | A full copy of the repository (AES-256, encrypted headers). |
| GitHub | **Still serves `X` by direct SHA** (`GET /repos/…/commits/a0dd18f…` → 200, 15 files, 2026-10-16). No branch has it as head. |

Checked and **clean**, with 0/14 originals and no `X`:
- the scratch publish repo `publish-step3.git`;
- the scratch review repos `step3-review`, `step4a-review`, `step4b-review` and `mac-review`;
- the synthetic test repos;
- the 7-Zip probe repos;
- all other repos under `C:\Users\jonmc\dev`.

A SHA-256 scan for **plaintext copies of the original images** found **none** in any of these locations:
- the recovery directory, the session scratchpad and `C:\tmp`;
- the repo working tree, including ignored files and `.git/gemini-review`;
- Downloads, Desktop and Pictures.

### 1.2 Other unreachable data that a prune would destroy (legitimate-work risk)

| Object | Status today | What a careless cleanup would lose |
|---|---|---|
| **Dropped stash `ef43841`** ("WIP on master: c9b904a", 2026-09-24; index commit `8bacb3e`; no untracked part) | Already **dangling**: no ref or reflog holds it | **Any** `gc --prune=now` deletes it. Of its 22 coach files, **9 hold content that exists nowhere else in history**: `coach/atbat.html` (+4/−1), `coach.css` (+4/−2), `compare.html` (+1/−1), `development.html` (+16/−11), `player.html` (+31/−78), `queue.html` (+2/−2), `report.html` (+5/−5), `review.html` (+25/−21), `team.html` (+5/−1). Whether it was dropped deliberately is unknown, so it is treated as legitimate. |
| **`655f7bf`** (2026-07-28, pre-rebase version of `081eed5`) | Reachable only via reflog entries (~80 days old) | It differs from `081eed5` by 1 line in 1 file. **A default `git gc` would expire it** (`gc.reflogExpireUnreachable` defaults to 30 days). This was confirmed in a back-dated synthetic rehearsal, where default gc → LOST and expiry disabled → KEPT. |
| 162 dangling blobs (3.78 MB) | Unreachable even counting reflogs | All are **text** by signature check: old versions of coach HTML/JS, edge functions, tests. There are **no images**. Pattern scan: 0 JWT values, 0 invite-token URLs, 0 API keys; 17 mention only the variable *name* `SUPABASE_SERVICE_ROLE`. Probably staged intermediates. Low value, but they cost nothing to export. |
| 121 trees, other dangling objects | Structural | Nothing on its own. |

**Model checkpoints and other assets:** gc only touches `.git/objects`. Ignored files are never touched by any step here:
`.venv_pose3d` (including the vendored MotionBERT/VideoPose3D sources and their own `.git` dirs, verified clean), `videos/`, `frames/`,
`.env`, and checkpoints. No checkpoint is tracked in Git, and there is no LFS.

## 2. Targeted reflog removal vs. controlled expiration

| | (A) **Targeted** — recommended | (B) `reflog expire --expire-unreachable=now --all` |
|---|---|---|
| What it removes | Exactly the 3 `@{1}` entries (→`X`). `--rewrite` turns each `@{0}` old-value from `X` into `P` | Every reflog entry not reachable from its ref's tip: `X`'s entries **and `655f7bf`'s** |
| Legitimate loss | None (`655f7bf` kept) | `655f7bf` recovery point |
| Error risk | Wrong selector. Mitigated by asserting `@{1}` == `X` before deleting, and by checking afterwards that no reflog line names `X` | Low, but broader than needed |
| Rehearsed | Yes (synthetic): `X` and the secret blob gone after gc; `@{0}` old-value became `P`; fsck clean | Not needed |

Both options require gc to run with reflog expiry **disabled**: `-c gc.reflogExpire=never -c gc.reflogExpireUnreachable=never`.
These are process-scoped, so no config is written. Without them, gc would also expire old entries such as `655f7bf`.

**Dangling stash:** the plan exports it in every case. The owner also chooses (**Decision D2**) whether to keep it in the object DB
under a local-only, create-only ref `refs/preserved/stash-2026-09-24`. That ref is never pushed (`push.default` would
not include it, and `--mirror`/`--all` pushes stay prohibited). Recommended: **yes**. It is ordinary coach source, contains no media,
and is recoverable with `git stash apply` or `git diff`.

## 3. Procedure (each stage needs owner approval; run in one Git Bash session)

```bash
cd /c/Users/jonmc/dev/softball_analysis || exit 1
set -u
B=/c/Users/jonmc/AppData/Local/HitterLoopRecoveryPreflight/step4b          # Step 4B backup (existing)
C=/c/Users/jonmc/AppData/Local/HitterLoopRecoveryPreflight/step4c          # new, fixed path
R=e961f34b355825ced08b0ad2e9344204ef6fccdd; X=a0dd18f52c33f9bb473500ade00caeb310cae71a; P=022f1fec96f3e554a508cdb3d932e73e83089319
J=655f7bf25ef61a419f779f9c0138c49331504a53   # July commit; ref-anchored in Stage 2 as refs/preserved/oldcommit-655f7bf
STASH=ef43841510868ee9a0ac7fc723a1545c69549e10; STASHBASE=c9b904adc1d92b028196112d2a76c87a2f61361f; STASHIDX=8bacb3ec97be836ed62249555200545751b4692a
die() { echo "STOP: $*" >&2; exit 1; }
D1=A        # owner decision D1: A (targeted, recommended) or B (expire)
D2=yes      # owner decision D2: yes (preserve stash ref, recommended) or no
EXPECTED_STATUS=$(printf ' M NEXT_STEPS.md\n M package.json\n'; grep '^?? ' "$B/status-before.txt"; echo '?? docs/evaluation/windows-history-cleanup-plan.md' ) # re-sort below
```

### 3.0 Preconditions (read-only assertions)
```bash
[ "$(git ls-remote origin)" = "$(printf '%s\tHEAD\n%s\trefs/heads/master' $R $R)" ] || die "remote"
[ "$(git symbolic-ref HEAD)" = refs/heads/master ] && [ "$(git rev-parse HEAD master origin/master | sort -u)" = "$R" ] || die "refs"
[ "$(git for-each-ref --format='%(refname)' | tr '\n' ' ')" = "refs/heads/master refs/remotes/origin/HEAD refs/remotes/origin/master refs/tags/engine-baseline-1.0.0 " ] || die "unexpected refs"
[ "$(git rev-parse engine-baseline-1.0.0)" = 47ac6ef85cdfca186c23a0ebcc644c4bf4b5e3ae ] || die tag
[ "$(git rev-parse f79b09e:scripts/pose3d)" = 766f4fbc64620d428da428e59b144554ca2f2a7b ] && [ "$(git rev-parse HEAD:scripts/pose3d)" = dae6dbe0a1f794fcd52a07f1c05b3ce0b6af8e4f ] || die engine
git diff --cached --quiet || die staged
[ "$(git status --porcelain=v1 | sort)" = "$(echo "$EXPECTED_STATUS" | sort)" ] || die "status drift"
( cd "$B/work" && sha256sum -c --quiet ../work-manifest.sha256 ) || die "4B backup"
cmp NEXT_STEPS.md "$B/work/NEXT_STEPS.md" && cmp package.json "$B/work/package.json" || die "work drift"
[ "$(wc -l < "$B/orig-blobs.txt")" = 14 ] || die "orig-blob list"
[ "$(git stash list | wc -l)" = 0 ] && [ "$(git worktree list | wc -l)" = 1 ] || die "stash/worktree"
ls .git/objects/pack | grep -qE '\.(keep|promisor)$' && die "keep/promisor pack present"
[ "$(git rev-parse HEAD@{1})" = $X ] && [ "$(git rev-parse refs/heads/master@{1})" = $X ] && [ "$(git rev-parse refs/remotes/origin/master@{1})" = $X ] || die "reflog selectors moved"
[ "$(cat .git/ORIG_HEAD)" = $X ] || die "ORIG_HEAD changed"
[ -e "$C" ] && die "$C exists"
```
Also confirm manually: no IDE, Git GUI, dev server or `git maintenance` schedule is running against the repo.

### 3.1 Preserve (writes only to `$C`, never to the repo)
```bash
mkdir -p "$C"/{reflogs,stash,oldcommit,dangling-blobs,isolated-clone-evidence}
cp -r .git/logs "$C/reflogs/logs"; cp .git/ORIG_HEAD "$C/reflogs/ORIG_HEAD"     # SHAs + local identity only; restores 3.3
git for-each-ref --format='%(refname) %(objectname)' > "$C/refs-before.txt"
git diff $STASHBASE $STASH > "$C/stash/stash-2026-09-24-worktree.patch"
git diff $STASHBASE $STASHIDX > "$C/stash/stash-2026-09-24-index.patch"
git diff --name-only $STASHBASE $STASH | while read p; do mkdir -p "$C/stash/files/$(dirname "$p")"; git cat-file blob "$STASH:$p" > "$C/stash/files/$p"; done   # raw blob, no filters
git diff 081eed5 655f7bf > "$C/oldcommit/655f7bf-vs-081eed5.patch"
git fsck --unreachable --no-progress 2>/dev/null | awk '$2=="blob"{print $3}' | while read b; do git cat-file blob $b > "$C/dangling-blobs/$b"; done
# isolated-clone evidence that Step 2 reports reference
IC=/c/Users/jonmc/AppData/Local/HitterLoopRecoveryPreflight/step2-20261015/isolated-clone
ls "$IC"/.git/gemini-review/*.md >/dev/null 2>&1 && [ -f "$IC/step2-security-review.json" ] || die "isolated-clone evidence missing"
cp "$IC/step2-security-review.json" "$IC"/.git/gemini-review/*.md "$C/isolated-clone-evidence/" || die "evidence copy"
# verification: signature scan (not extension) proves no media in $C
find "$C" -type f | while read f; do s=$(head -c 4 "$f" | od -An -tx1 | tr -d ' \n'); case $s in 89504e47|ffd8ff*|47494638) echo "$f";; esac; done | grep -q . && die "image bytes in preserve dir"
[ "$(find "$C/stash/files" -type f | wc -l)" = 22 ] || die "stash file export incomplete"
[ "$(ls "$C/dangling-blobs" | wc -l)" = 171 ] || die "dangling-blob export count != 171 (state changed; re-inventory)"
for p in $(git diff --name-only $STASHBASE $STASH); do [ "$(git hash-object --no-filters "$C/stash/files/$p")" = "$(git rev-parse $STASH:"$p")" ] || die "stash export mismatch $p"; done
( cd "$C" && find . -type f ! -name manifest.sha256 -exec sha256sum {} + | sort -k2 ) > "$C/manifest.sha256"
```
The dangling-blob count exported should be 171: 162 loose + 9 from the stash tree. The stash is preserved twice, as two patches and as 22 full files
verified by blob ID.

### 3.2 (Decision D2) preserve the stash as a local-only ref
```bash
if [ "$D2" = yes ]; then git update-ref -m "step4c: preserve dropped stash" refs/preserved/stash-2026-09-24 $STASH 0000000000000000000000000000000000000000 || die "create-only ref failed"; fi
```

### 3.3 Remove every local reference to `X` (reversible until 3.4)
Option A (recommended):
```bash
if [ "$D1" = A ]; then
  git reflog delete --rewrite HEAD@{1} refs/heads/master@{1} refs/remotes/origin/master@{1} || die "reflog delete"
elif [ "$D1" = B ]; then
  git reflog expire --expire-unreachable=now --rewrite --all || die "reflog expire"
else die "D1 must be A or B"; fi
git update-ref -d ORIG_HEAD $X || die "ORIG_HEAD CAS"
```
Option B instead: `git reflog expire --expire-unreachable=now --rewrite --all`, then the same `ORIG_HEAD` command. `--rewrite` is defensive here: in a synthetic git 2.55 rehearsal, X was gone from the logs even without it. The `grep` check below is authoritative either way.

Verify before any pruning:
```bash
grep -rl $X .git/logs && die "a reflog still names X"
[ -e .git/ORIG_HEAD ] && die "ORIG_HEAD remains"
git for-each-ref --contains $X | grep . && die "a ref contains X"
[ "$(git rev-list --objects --all --reflog --indexed-objects | awk '{print $1}' | grep -c -x -F -f "$B/orig-blobs.txt")" = 0 ] || die "original blob still reachable"
git fsck --unreachable --no-progress 2>/dev/null | grep -q "^unreachable commit $X" || die "X not unreachable"
[ "$D1" = A ] && { [ "$(git reflog show --format=%H HEAD | sed -n 2p)" = $P ] || die "HEAD reflog chain not rewritten to P"; }
[ "$D1" = A ] && { git cat-file -e 655f7bf || die "655f7bf missing"; }
```
**Undo for 3.3:** `rm -rf .git/logs && cp -r "$C/reflogs/logs" .git/logs && cp "$C/reflogs/ORIG_HEAD" .git/ORIG_HEAD`.

### 3.3a Stage 3 pre-prune assertions (post-Stage-2 state; added 2026-10-16 after Stage 2)
Stages 1–2 legitimately added `refs/preserved/stash-2026-09-24` (D2) and, by separate owner authorization in Stage 2,
`refs/preserved/oldcommit-655f7bf`. The §3.0 ref-set assertion (4 refs) is therefore superseded **for Stage 3 only** by the
six-ref assertion below. Every other §3.0 assertion is repeated or strengthened here, not relaxed.
```bash
S2="$C/reflogs-stage2"
[ "$(git ls-remote origin)" = "$(printf '%s\tHEAD\n%s\trefs/heads/master' $R $R)" ] || die "remote"
[ "$(git symbolic-ref HEAD)" = refs/heads/master ] || die "HEAD not on master"
[ "$(git for-each-ref --format='%(refname) %(objectname)')" = "$(printf 'refs/heads/master %s\nrefs/preserved/oldcommit-655f7bf %s\nrefs/preserved/stash-2026-09-24 %s\nrefs/remotes/origin/HEAD %s\nrefs/remotes/origin/master %s\nrefs/tags/engine-baseline-1.0.0 47ac6ef85cdfca186c23a0ebcc644c4bf4b5e3ae' $R $J $STASH $R $R)" ] || die "six-ref set differs"
[ "$(git rev-parse 'engine-baseline-1.0.0^{commit}')" = f79b09e63092e87efd1250c3b263d29086d81a79 ] || die "tag target"
[ "$(git rev-parse f79b09e:scripts/pose3d)" = 766f4fbc64620d428da428e59b144554ca2f2a7b ] && [ "$(git rev-parse HEAD:scripts/pose3d)" = dae6dbe0a1f794fcd52a07f1c05b3ce0b6af8e4f ] || die "engine trees"
[ "$(git write-tree)" = "$(git rev-parse $R^{tree})" ] && git diff --cached --quiet || die "index"
[ "$(git status --porcelain=v1 | sort)" = "$(echo "$EXPECTED_STATUS" | sort)" ] || die "status drift"
grep -rl $X .git/logs && die "a reflog names X"
[ -e .git/ORIG_HEAD ] && die "ORIG_HEAD exists"
for f in FETCH_HEAD MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD; do [ -e .git/$f ] && grep -q $X .git/$f && die "$f names X"; done
git for-each-ref --contains $X | grep . && die "a ref contains X"
[ "$(git rev-list --objects --all --reflog --indexed-objects | awk '{print $1}' | grep -c -x -F -f "$B/orig-blobs.txt")" = 0 ] || die "original blob reachable"
[ "$(git rev-list --objects --all --reflog --indexed-objects | awk '{print $1}' | grep -c -x $X)" = 0 ] || die "X reachable"
[ "$(git fsck --unreachable --no-progress 2>/dev/null | awk '$2=="commit"{print $3}')" = $X ] || die "unreachable-commit set is not exactly {X}"
( cd "$B/work" && sha256sum -c --quiet ../work-manifest.sha256 ) && cmp NEXT_STEPS.md "$B/work/NEXT_STEPS.md" && cmp package.json "$B/work/package.json" || die "work"
git ls-files --others --exclude-standard -z | while IFS= read -r -d '' f; do [ "$f" = docs/evaluation/windows-history-cleanup-plan.md ] && continue; cmp "$f" "$B/work/$f" || exit 1; done || die "untracked work"
( cd "$C" && sha256sum -c --quiet manifest.sha256 ) && [ "$(wc -l < "$C/manifest.sha256")" = 204 ] || die "stage-1 manifest"
( cd "$S2" && sha256sum -c --quiet ../reflogs-stage2.manifest.sha256 ) || die "stage-2 snapshot"
[ "$(ls "$C/dangling-blobs" | wc -l)" = 171 ] || die "dangling export count"
for f in "$C"/dangling-blobs/*; do [ "$(git hash-object --no-filters "$f")" = "$(basename "$f")" ] || die "export $f"; done
[ "$(git cat-file -t $J)" = commit ] && [ "$(git cat-file -t $STASH)" = commit ] || die "preserved objects"
ls .git/*.lock .git/refs/heads/*.lock .git/objects/pack/*.lock 2>/dev/null | grep . && die "lock file present (concurrent git?)"
ls .git/objects/pack | grep -qE '\.(keep|promisor)$' && die "keep/promisor pack"
git config --local --name-only --list | grep -E '^(gc\.|maintenance\.|extensions\.|core\.hookspath|remote\..*\.(push|mirror)|push\.)' && die "unexpected local config"
[ "$(git config --local --get core.repositoryformatversion)" = 0 ] || die "repositoryformatversion"
[ "$(git config --local --get pull.ff)" = only ] && [ "$(git remote get-url origin)" = https://github.com/jonmcurry/player-scouting-report.git ] || die "config/remote"
git config --local --list | sha256sum > "$C/stage3-config-before.sha256"
```

### 3.4 Prune (POINT OF NO RETURN)
```bash
git -c gc.reflogExpire=never -c gc.reflogExpireUnreachable=never gc --prune=now || die gc
```

### 3.5 Post-cleanup verification
```bash
git cat-file -e $X 2>/dev/null && die "X still present"
while read b; do git cat-file -e $b 2>/dev/null && die "original blob $b still present"; done < "$B/orig-blobs.txt"
git fsck --full --no-dangling --no-progress || die "fsck: repository damaged"
[ "$(git count-objects -v | awk '/^garbage:/{print $2}')" = 0 ] || die garbage
git for-each-ref --format='%(refname) %(objectname)' | sort | diff - <( { cat "$C/refs-before.txt"; [ "$D2" = yes ] && echo "refs/preserved/stash-2026-09-24 $STASH"; echo "refs/preserved/oldcommit-655f7bf $J"; } | sort ) || die "refs changed"   # July ref added in Stage 2
git config --local --list | sha256sum | diff -q - "$C/stage3-config-before.sha256" >/dev/null || die "local config changed by gc"
[ "$(git rev-parse HEAD)" = $R ] && [ "$(git write-tree)" = "$(git rev-parse $R^{tree})" ] || die "HEAD/index"
[ "$(git status --porcelain=v1 | sort)" = "$(echo "$EXPECTED_STATUS" | sort)" ] || die "status changed"
( cd "$B/work" && sha256sum -c --quiet ../work-manifest.sha256 ) && cmp NEXT_STEPS.md "$B/work/NEXT_STEPS.md" && cmp package.json "$B/work/package.json" || die "work files"
git ls-files --others --exclude-standard -z | while IFS= read -r -d '' f; do [ "$f" = docs/evaluation/windows-history-cleanup-plan.md ] && continue; cmp "$f" "$B/work/$f" || exit 1; done || die "untracked work"
[ "$(git rev-parse engine-baseline-1.0.0)" = 47ac6ef85cdfca186c23a0ebcc644c4bf4b5e3ae ] && [ "$(git rev-parse f79b09e:scripts/pose3d)" = 766f4fbc64620d428da428e59b144554ca2f2a7b ] || die "baseline"
[ "$D1" = A ] && { git cat-file -e 655f7bf || die "655f7bf lost"; }
[ "$D2" = yes ] && { git cat-file -e $STASH || die "preserved stash lost"; }
[ "$(git rev-parse refs/preserved/oldcommit-655f7bf)" = $J ] && git cat-file -e $J && [ "$(git diff 081eed5 $J | sha256sum | cut -c1-64)" = "$(sha256sum < "$C/oldcommit/655f7bf-vs-081eed5.patch" | cut -c1-64)" ] || die "July ref/commit"
( cd "$C/reflogs-stage2" && sha256sum -c --quiet ../reflogs-stage2.manifest.sha256 ) || die "stage-2 snapshot"
( cd "$C" && sha256sum -c --quiet manifest.sha256 ) || die "preserve dir"
npm run check:no-media && npm run check:baseline && npm run test:privacy || die "guards"
```
Expected: `X` and the 14 blobs are absent. The stash survives only under D2 (otherwise only as exports). `655f7bf` survives under A.
Git still works normally: `git log`, `git status`, and the build all run.

### 3.6 Isolated Step 2 clone (separate approval; irreversible)
This needs **3.1's evidence copy first**. Its other refs (`sanitized-step2` `f635cf2`, `sanitized-step2-final` = `R`) hold no unique
work: `R` is on GitHub, and `f635cf2` is a superseded sanitization candidate whose reviewed successor is `R`. Then:
`rm -rf /c/Users/jonmc/AppData/Local/HitterLoopRecoveryPreflight/step2-20261015/isolated-clone`. Keep the rest of `step2-20261015`
(logs and reports).

### 3.7 Optional tidy (separate approval)
- The scratch repos in the session scratchpad are verified clean and may be deleted.
- `.git/gemini-review/smoke.png` (4.8 KB, dated 2026-10-11) predates the exposed commit and matches no original hash. Owner: review it and keep or delete.

## 4. Rollback capabilities lost

| After | Lost | Remaining fallback |
|---|---|---|
| 3.3 | Nothing yet. Fully undoable from `$C/reflogs` | — |
| 3.4 | Step 4B Git-level rollback (`git read-tree X …`); any way to inspect `X` locally; the 162 loose dangling blobs in-repo; the dropped stash in-repo (unless D2) | `$C` exports (stash patches and files, dangling blobs, `655f7bf` patch); the encrypted archive (restore **to a new directory only**) |
| 3.6 | The isolated clone's copy of `X` | Encrypted archive |
| Archive disposal (§5) | The last local copy of `X`, and the full pre-recovery state, including ignored assets as they were on 2026-10-15 | None |

## 5. Encrypted backup retention and disposal

Recommendation: **retain** `hitterloop-complete.7z` (24 GB, SHA-256 `3fcc4ba8…bec4e0f`) until **all** of the following hold:
1. Step 4C has passed §3.5.
2. The Mac is reconciled and cleaned, or explicitly retired.
3. GitHub Support has confirmed the purge, and `X` returns 404.
4. A 30-day observation window has passed without needing pre-recovery state.

Until then:
- keep it on local disk only, never in a cloud-synced folder;
- keep the password out of any repo, log or AI context;
- restore it only to a new directory.

Disposal (a separate owner decision):
- Delete the archive and any verification extracts.
- Deletion on NTFS is **not** forensic erasure. If the volume is not BitLocker-protected, consider `cipher /w:C:\` to overwrite free space, which takes a long time.
- The AES-256 encryption limits the residual risk to password strength.
- Before disposal, confirm that the 59,801 ignored files it captured (videos, frames, `.env`, venvs) are still present or otherwise backed up. The archive may be the only historical copy of some of them.

## 6. GitHub sensitive-object purge (separate authorization; outward-facing)

Per GitHub's documentation ("Removing sensitive data from a repository", checked 2026-10-16), force-pushed commits can stay
accessible "directly via their SHA-1 hashes in cached views". Only GitHub Support can remove cached views and run a server-side GC.
Prerequisites: every reference other than PRs is cleaned up, and no fork holds the data. Both are true now: only `master` = `R`
is advertised, there are 0 forks and 0 PRs.

The request goes through the GitHub Support portal and includes only:
- owner/repo `jonmcurry/player-scouting-report`;
- number of affected PRs: 0;
- first changed commit `a0dd18f52c33f9bb473500ade00caeb310cae71a`, replaced by `e961f34b355825ced08b0ad2e9344204ef6fccdd`;
- no LFS objects;
- a one-line non-sensitive description: "14 screenshots containing personal information of a minor and a since-revoked invitation".

Never attach or describe the image contents.

Support's limits: it can't remove data from clones, it removes no non-sensitive data, and it helps only where rotating a credential doesn't mitigate the risk.
Here the core exposure is personal data in images, which can't be rotated.

Verify afterwards (read-only): `gh api repos/jonmcurry/player-scouting-report/commits/a0dd18f52c33f9bb473500ade00caeb310cae71a` → expect 404.
Re-run it periodically until that holds.

## 7. Exposed invitation status

This comes from existing authorized evidence. It was **not** re-queried today, and redemption was never attempted.
`docs/evaluation/git-history-remediation-plan.md` records:
- the single exposed invitation was **revoked at 2026-10-15 00:26:32 UTC** through the owning coach's existing session;
- it was verified by read-only queries: used = false, usable = false, 0 guardians linked;
- it would have expired anyway at **2026-10-19 21:56:14 UTC**.

**Open question (Q3):** that evidence comes from the **local** Supabase stack. The owner should confirm the invitation never existed on any
hosted Supabase project. If it might have, its status there is unverified.

## 8. Stop conditions
- Any §3.0 assertion fails, including a remote change, ref drift, status drift, a moved reflog selector, a `.keep` pack, or `ORIG_HEAD` ≠ `X`.
- §3.1 finds image bytes in `$C`, or a stash export mismatch.
- After 3.3, anything still reaches `X` or an original blob. Undo from `$C/reflogs`; do **not** run 3.4.
- 3.4 exits non-zero, or §3.5 fsck reports missing or broken objects. Stop and restore the archive to a new directory for comparison; never restore over the live repo.
- Any check would print image content, a token, a credential or an e-mail address into a log or AI context.
- Any requirement to touch the Mac, GitHub, the archive, or refs beyond what's listed here.

## 9. Outstanding security risks after Step 4C
- **GitHub still serves `X` by direct SHA** until Support acts. This is the most significant remaining exposure.
- Any clone, fetch, cache or download since the original push may hold `X`. The Mac clone is un-inventoried.
- The encrypted archive holds the originals until it is disposed of.
- On-disk remnants:
  - deleted pack data isn't forensically erased;
  - Windows thumbnail and search caches may hold previews if the originals were ever opened in Explorer;
  - Time Machine-equivalent backups, such as File History or OneDrive, if enabled, may hold copies. **The owner should confirm none are enabled for this path.**
- Running `git pull` on any stale clone would re-merge `X`. `pull.ff=only` is now set locally on Windows only.

## 10. Owner decisions requested
- **D1:** targeted reflog deletion (A, recommended) or `reflog expire` (B).
- **D2:** keep the dropped 2026-09-24 stash as the local-only ref `refs/preserved/stash-2026-09-24` (recommended), or keep exports only.
- **D3:** approve each stage separately: 3.1–3.3 (reversible), 3.4 (irreversible), 3.6 (clone deletion), 3.7 (tidy).
- **D4:** archive retention per §5. **D5:** authorize the GitHub Support request per §6. **Q3:** hosted-Supabase confirmation (§7).

## 11. Test and review status
- The full `npm test` is **not green**: 15 failures from absent Supabase credentials, plus 2 known coach/brand failures (CRLF schema regex, PR7 legacy-brand fixtures).
  No full-suite pass is claimed. `check:no-media`, `check:baseline` and `test:privacy` (116 pass / 3 skip / 0 fail) are the gates used here.
- The §2/§3 commands were rehearsed on synthetic repositories only, never on project data.
- The independent Gemini/AGY review of this plan is recorded in the orchestrator's report.
- Codex was not used: both CLAUDE.md files currently exclude it.
