# Screenshot privacy remediation — PR10 preflight only

Date: 2026-10-14. Scope: the 14 tracked PNG screenshots introduced by `a0dd18f`. No worker integration, production behavior change, staging, commit, push, deployment, history rewrite, invitation validation or credential revocation is authorized or performed here.

## Four separate statuses

- **Local screenshot sanitization:** all 14 working-tree files have opaque black pixel replacements. Original dimensions (1024 × 2216) are preserved. Fresh RGB PNG encoding removes metadata, alpha, additional frames and trailing data. The inventory records original and sanitized SHA-256 hashes, exact redaction rectangles, sensitive-content categories and an individual retention purpose. Codex reviewed all full-size sanitized images; Gemini successfully reviewed all 14 through four sanitized-only contact sheets with no blocking privacy findings. Only those sanitized hashes were then added to the working-tree allowlist, as authorized by the user.
- **Current Git index:** unchanged; it still references the original sensitive images. The exact-hash media guard must continue failing until a separately authorized index update replaces them with reviewed sanitized bytes. Do not approve original hashes, use an alternate index to manufacture a pass, or weaken the guard.
- **Historical Git exposure:** unchanged. Original image blobs remain reachable through `a0dd18f` and may exist in published history, clones, caches or backups. Local image replacement does not remove those copies. Remote publication status was not queried. History remediation requires separate authorization and a concrete scope/rollback plan.
- **Potentially active invitation:** the October 12 invitation is treated as potentially active. Its validity was not tested, no invitation URL was opened, and no backend or external service was contacted to investigate it. Redaction does not revoke an invitation. Invalidation/revocation requires separate authorization identifying the affected service and invitation securely.

## Inventory and review method

See [screenshot-privacy-inventory.json](screenshot-privacy-inventory.json) for all 14 paths, original and sanitized hashes, tracking status at inventory time, categories and retention decisions. Every original working copy and index blob matched the corresponding image in `a0dd18f` before editing. No original text, OCR transcription, token or name is included in the inventory.

Local RapidOCR was used to locate text without emitting its contents. Only generic UI labels were retained in masked inspection previews. Manual broad field/card redactions supplement OCR, including partially obscured report content behind dialogs. Individual coaching prose, dates, player status, roster attributes, avatar initials, identities, invitation recipient and the entire invitation URL field were removed. The device status bar was removed in every image; the settings preference checkbox was also covered.

All 14 sanitized files were visually inspected. No private footage is visible: the report video panel contains a broken-media placeholder, not a player frame. The only retained illustration is the static filming guide. Original PNG chunks were IHDR, sRGB, sBIT, IDAT and IEND; no text/EXIF chunks were present. Sanitized files contain only IHDR, IDAT and IEND, with valid CRCs and no bytes after IEND. OCR is supplemental evidence, not proof of absence of sensitive content.

The screenshots remain useful as redacted historical UI layout references for the October 12 redesign audit: error state, Home, invitation dialog, legacy roster/activity, player views, report layout, Progress, capture choices, filming instructions and Settings. They are not fictional athlete examples, evidence of successful playback, or evidence of coaching correctness. Conservative redactions intentionally remove some generic labels as well as private content. No new UI rendering or UI design was implemented.

The original audit's statement that screenshots were untracked describes its October 12 state and is no longer current after `a0dd18f`. These replacements do not silently revise that historical audit.

## Verification

`python scripts/privacy/verify_screenshot_redactions.py` checks all 14 exact sanitized hashes, dimensions, PNG structure and CRCs, lack of metadata/alpha/extra frames/trailing bytes, and every recorded solid-black rectangle. It reads only working-tree images, never historical originals. Requires Python and Pillow; it is not a replacement for the repository Git-index media guard or visual review.

Windows validation: the 14-image verifier, build, whitespace and baseline guard pass. A supplemental local OCR check detected original identity/invitation text as a positive control, then found none of those strings or URL patterns in the 14 sanitized files; it emitted only pass/fail categories, never the original text. Full `npm test` passes its pretest suites (9 Python baseline, 14 golden, 25 instrumentation, 61 PR7 and 94 PR8 tests), then correctly stops at the 14 original indexed images. `npm run test:privacy` stops at the same gate. Before the allowlist update these were `UNAPPROVED_MEDIA`; afterward the original indexed bytes must be rejected as `ASSET_CONTENT_CHANGED_IN_INDEX` while working-tree bytes match. Separately invoked privacy guard tests have 53 passes, 3 Windows skips and 1 expected repository-index failure; the 62 privacy/adapter/deletion tests pass. Initial sandbox process/temp-directory access failures were resolved by rerunning with normal local permissions.

Other separately executed regression commands: baseline 13/13, migration-version checks 3/3, drills 13/13, PR3 annotations 82/82, main compiled application suite 555 passes / 1 skip / 0 failures. Coach/brand suite: 247 passes and 1 pre-existing failure. The brand guard rejects a historical reconstruction-format identifier intentionally used as an invalid-engine fixture in `src/services/config/analysisFlags.cases.ts:26` and `src/services/development/evidenceRegistry.test.ts:90`. Both files are unchanged from HEAD; no brand/evidence policy was changed as part of screenshot remediation. These separately executed suites are not a claim that `npm test` passed.

Independent review is restricted to sanitized assets and this remediation's code/documentation. Four sanitized-only contact sheets (each image shown at half size) are available locally at `.agent-tmp/screenshot-review/sanitized-sheet-1.png` through `sanitized-sheet-4.png`, in the inventory's order. The files were generated only after the final opaque masks were verified. No original image, OCR text or historical blob was sent to Gemini.

## Independent review and reconciliation

The repository `Invoke-OrchestratedQA.ps1` wrapper completed successfully using Gemini 3.8 Flash (High). Review artifact: `.git/gemini-review/review-20261014-103827-b083c0.md`. Gemini explicitly confirmed successful rendering/inspection of all four sheets and all 14 sanitized assets. It reported **0 blockers**, **1 non-blocking finding** (explicit UTF-8 decoding in the verifier, fixed and rechecked), and **2 judgment notes** (index authorization and historical/token lifecycle).

The user explicitly authorized the allowlist update after sanitized review, so that update proceeded. Staging remains prohibited. History cleanup and invitation revocation remain unapproved. Gemini's suggestion that allowlisting also needs a new authorization is superseded by the user's existing explicit authorization. Model review does not establish token expiry or history cleanup. No private originals were submitted for review.

Follow-up orchestrated review `.git/gemini-review/review-20261014-195726-fb20f6.md` completed successfully after the allowlist/UTF-8 changes: **0 blockers and 0 non-blocking findings**. It confirmed all 14 allowlist hashes match sanitized (not original) hashes, with no wildcard or guard bypass. Its two remaining operational notes are the deliberately unchanged index and the unrevoked invitation. A separate deterministic audit confirmed every pre-existing allowlist entry is unchanged and no files are staged. The final full `npm test` invocation again passed pretests and stopped on exactly 14 `ASSET_CONTENT_CHANGED_IN_INDEX` violations; the final guard unit run again had 53 passes, 3 skips and the expected one index-state failure.

## Exact task file inventory

- Modified: the 14 PNG paths enumerated in `screenshot-privacy-inventory.json`; `scripts/media-asset-allowlist.json`; the new privacy-preflight entry in `NEXT_STEPS.md` (existing PR9 content preserved).
- Added: this document, `docs/evaluation/screenshot-privacy-inventory.json`, and `scripts/privacy/verify_screenshot_redactions.py`.
- Existing unrelated PR9 work preserved: prior changes to `package.json` / `NEXT_STEPS.md`, and untracked `docs/evaluation/evidence-persistence.md`, migration `00065`, and `supabase/tests/clipEvidenceAssessments.test.ts`.
- Ignored local scratch: sanitization/OCR scripts, sanitized review sheets and test logs under `.agent-tmp/`. The 14 preliminary masked inspection previews were removed after final review; no raw OCR transcription or additional original image copy was persisted there. These are not release artifacts.

PR10 remains stopped. Any subsequent index update, historical remediation or invitation revocation requires further authorization; none is implied by approval of sanitized images.
