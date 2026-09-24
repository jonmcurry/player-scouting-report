# Privacy-treated video for the public demo

Real game footage always contains other people: the opposing catcher,
pitcher and fielders, umpires, coaches, and spectators, most of them
minors. Before any clip can appear in the public demo, every person except
the analyzed batter must be made unrecognizable. The batter's swing and
the stored analysis must be preserved exactly. This document covers the
tooling (`scripts/privacy/`), the gates, and the manual approval procedure.

Status (2026-09-24): six real clips processed locally. **Nothing has been
published.** Per-clip results and the review packet are local only, in
`demo-export/privacy/` and `demo-export/EMILY_REVIEW_WORKSHEET.md`
(gitignored).

## Method (`scripts/privacy/anonymize_clip.py`)

- **The identity comes from the analysis itself.** The subject is the
  pose3d pipeline's own tracked batter (`frames/<player>/<clip>/pose_2d.json`),
  never "largest" or "most central" person. The tool never re-decides who
  the subject is. It only checks that the pipeline's choice is trustworthy:
  - **Bat-holder gate (clip level):** the tracked bat's knob must be
    nearest the subject's wrists in at least 85% of judged frames.
    Otherwise the clip is REJECTED, because the stored analysis isn't of
    the batter.
  - **Track-continuity gate (per frame):** a body-size jump above 1.35×,
    or a centre jump above 0.25 body heights per frame, means the track
    switched to someone else. Every frame from there to the end is fully
    obscured, and re-acquisition is never trusted. A switch inside the
    analysis phase window rejects the clip.
  - A **torso-colour identity check was tried and rejected**. The
    batter's jersey front and back differ, so it fired on every turn,
    while missing nothing geometry doesn't catch.
- **Obscured by default (inverse mask).** Only a keep region is left
  intact: the subject's keypoint body plus a 5% margin, and the tracked
  bat. Everything else is pixelated and blurred. That covers spectators,
  reflections, uniforms and numbers, and people a detector misses, without
  relying on detection. A wider margin (12%) was measured to expose a
  spectator standing at the fence and was reduced.
- **Other people inside the keep region are masked too.** Two detector
  architectures run: YOLO11-pose with ByteTrack tracking, and YOLOv8m.
  Both use a low threshold (0.10) at 1920 px inference. Every
  non-subject box is padded 15% and held for 8 frames after it
  disappears. Only the subject's own tight body outline overrides these
  masks, **not the bat**: a bystander's head next to the bat tip is
  obscured.
- **Fail closed.** Frames with too few reliable subject joints are
  fully obscured, and so is everything more than 1.0s after the last
  analysis phase. That running and fielding footage isn't swing evidence,
  and it's where both observed track switches happened.
- **No crop, no generative alteration, no re-timing.** Every frame is
  written, in order, at the analysis frame rate (CFR), uniformly scaled
  to 1280 px wide. Output frame *i* is analysis frame *i*, at *i*/fps, the
  same clock as `swing_phases.time_s` and pose frames. Because the scale is
  uniform, the transform to analysis pixels is a single factor
  (`scale_from_analysis_px` in the summary). The demo draws no 2D
  overlay on the video; the 3D skeleton view is independent of video
  pixels.

### The batter's own jersey lettering

The family has not authorized publishing the batter's surname (back name
bar) or real team name (chest lettering). `jersey_mask()` obscures both in
every frame the batter is visible, using the same pixelate+blur as
everything else.

- **Shape.** An oriented band that follows the pipeline's shoulder->hip
  axis, so it stays on the jersey through the turn, rotation and
  follow-through. It runs from 0.10 x body height above the shoulder line
  (the back name bar sits there) to 85% of the way to the hips (chest
  lettering). The first value, 62%, left the lower letters visible while
  she leaned forward running out of the box. Half-width is max(1.4 x half the shoulder span, 0.18 x body
  height), so side-on frames stay covered. The first minimum, 0.10, left
  the edge of the chest lettering visible on a side-on forward lean.
- **No limb carve-outs.** Only the head is carved out, and only above the
  shoulder line, because the name bar sits just below it. The first
  version also carved out arms, hands and bat. On real footage a limb line
  drawn from keypoints doesn't sit exactly on the limb, and fragments of
  the chest lettering showed beside the forearm. Arms, hands and bat are
  now obscured only where they cross the band; everywhere else they stay
  visible.
- **Helmet decals.** The helmet carries the surname and number on the
  back, and a script team wordmark on the front of the shell above the
  brim. `helmet_mask()` obscures the whole helmet except a small face
  window around the nose, below the brim line, so head position and eyes
  stay visible. When the face isn't visible (turned away), the whole
  helmet is obscured. An intermediate version masked only the back half,
  and the front wordmark was then found by zooming the head. The first pass missed this, and OCR missed it too, because the
  decal was too small. It was found by zooming the frames where the back
  name bar was legible. OCR now also reads an upscaled head crop.
- **Fallback.** With no reliable shoulders, the band becomes a coarse box
  over the upper torso, flagged `lettering_mask_fallback`. Any such frame
  sends the clip to manual review.
- **Checks.**
  - The validator flags `subject_lettering_detail_survives` when the upper
    torso keeps more than 25% of its source detail.
  - `ocr_check.py` (RapidOCR, separate `.venv_ocr`) reads every frame
    twice, as the full frame and as an upscaled subject crop. It runs on
    the SOURCE as a sensitivity baseline, so a "not found" in the output
    means something, and on the OUTPUT, where both words must be
    `NOT_FOUND`. The words are passed on the command line only and are
    never stored in the repo.
  - A human still checks the contact sheets. OCR can't read every angle,
    and some source clips never show the lettering legibly.

### Prototype: precise lettering mask (`--lettering-mode precise`)

The broad band hides trunk posture and rotation. Precise mode obscures only
the lettering it finds in each frame, and the default stays `broad`:

1. **Silhouette.** YOLO11m-seg segments the subject. The search zone is the
   broad band plus the helmet disc, clipped to the silhouette.
2. **Strokes.** Candidates are thin, bright, low-chroma strokes, found with a
   white top-hat. A brightness-only version merged sky, glare and side panels
   with the letters and covered more than the broad band.
3. **Whole words.** Each word's filled, padded outline is obscured; blurring
   only the strokes would keep the letter shapes readable.
4. **Exclusions.** Long thin piping is not text, and gloves and the bat don't
   seed outlines.
5. **Gap cover.** Outlines from ±1 frame, shifted with the torso, cover a
   one-frame detection miss.
6. **Fallback.** A frame without a silhouette uses the broad mask.

Tooling for judging it:

- `check_lettering.py`: a stricter, independent residual check. It reports
  per-frame surviving stroke clusters by class (glove, piping, edge, other)
  plus torso and helmet visibility. It's calibrated on the visually confirmed
  broad output, which gives 0 uncertain frames.
- `compare_torso_pose.py`: re-detects shoulders and hips on a treated output
  to measure how readable the trunk is.
- `review_all_frames.py`: every frame, enlarged.
- `compare_treatments.py`: a side-by-side video and phase stills.

On `ab2_swingmiss` (2026-09-24), the prototype passed automated and full
visual review. It doubled the visible torso and cut the re-detected
shoulder-line error from 8.5° to 2.9°. The gain is mostly in setup and load;
after contact the back view is still mostly name and number. The results and
package are in `demo-export/privacy/prototype-ab2_swingmiss/REPORT.md`
(local only). The mode isn't applied to the other clips yet.

### Keeping the jersey number (2026-09-24 decision)

The family allows #10, but not the surname or the real team name. The
precise mode leaves an outline visible only when `classify_numbers.py`
confirms it is the number. Every other outline stays masked; privacy wins
every tie.

- **Pass A.** It writes a components cache: each outline's position along
  the torso, its shape, whether it is on the helmet, and whether it is in
  the glove/bat area.
- **OCR confirmation.** OCR reads each lower-torso, roughly square outline
  from the full-resolution source, turned upright. Every scale must read
  only digits of `--number`.
- **Tracking.** A confirmed number is tracked to neighbouring frames only
  through outlines where OCR saw no letter of a protected word.
- **Found in review, fixed before the final pass:**
  - A team-name outline was read as "0" at one scale, which is why every
    scale must agree now.
  - Team-name letters beside the gloves showed, because the glove area had
    been excluded from detection. Lettering there is now masked separately,
    in small outlines that are never exempt.
- **Results.** #10 is visible in 0 to 48 frames per clip. Everything
  exempted is shown on `review_numbers.py`'s local sheet for visual
  confirmation.

For a trimmed source (Stage 0 analyzed a window of a longer upload), the
tool runs on that exact window, regenerated with Stage 0's own ffmpeg
command. Alignment is then *proven* by the validator below, not assumed.

## Independent validation (`scripts/privacy/validate_privacy.py`)

This step checks the **encoded file** and reuses none of the anonymizer's
masks:

- **Timing:** frame count, fps, and duration equal the analysis. There is
  no audio, and the output is H.264 yuv420p.
- **Coverage, every frame:** both detectors at 2560 px (more sensitive
  than the anonymizer) find people in the *source* frame. For each
  non-subject person, the output must destroy detail. The limits are:
  - whole-box Laplacian energy at most 20% of the original
  - the head band at most 12%
  - at most 15% of textured pixels untouched

  The subject's own limbs and bat, taken from the pipeline data, are
  excluded from the measurement.
- **Fail-closed frames really are obscured:** frames after a track switch
  or the post-swing cutoff must keep no detail. This is measured by detail
  loss, not colour similarity, because a blurred dark torso still "matches"
  in colour.
- **Alignment:** pose re-detected on the *output* must match `pose_2d`,
  with a median error of at most 6% of body height. This proves output frame
  *i* shows the same moment of the same swing.
- **Report only, not a failure:** "silhouette detectable". An obscured
  blob can still read as "a person", but that doesn't make it identifiable.

## Classification

| Status | Meaning | Can it be published? |
|---|---|---|
| `PASS_CANDIDATE` | all automated checks passed, and the validator found nothing | only after human approval |
| `NEEDS_MANUAL_REVIEW` | anything a human must judge, such as another person's head overlapping the subject's outline (the tool can't tell who is in front), validator findings, or a track switch outside the phase window | only after human approval with `resolvedReviewItems: true` |
| `REJECT` | wrong subject, a track switch inside the phase window, the subject unreliable in the swing window, frame count or timing mismatch, or validator FAIL | **never** |

## Review procedure (human)

For each clip, look at these files in `demo-export/privacy/` (local only):

1. **`<clip>.mp4`:** watch the whole clip at normal speed, then step
   frame by frame through the swing.
2. **`<clip>.sheet.jpg`:** the public view of sampled and phase frames.
3. **`<clip>.risk.jpg`:** every flagged and track-transition frame, in the
   public view.
4. **`<clip>.debug.jpg`:** the visible region (green) and masked people
   (red, with track ids).
5. **`review/<clip>.findings.jpg`:** source-versus-output zooms of every
   flagged region. **The left half shows unobscured bystanders; never
   share it.**
6. **`review/<clip>.lettering.jpg`:** source-versus-output head-to-hips
   pairs across the whole clip, plus every frame where OCR read a
   protected word in the source (tagged `OCR`). Check the name bar, the
   chest lettering and both helmet decals. This file is local only.
7. **`<clip>.summary.json` / `<clip>.validation.json`:** the listed frames.

Confirm, for every listed frame:

- the batter's surname and team name aren't readable anywhere: jersey back, jersey front, helmet, or a reflection
- no other person's face, body, uniform text or number is recognizable
- the visible region is the batter, never someone else
- the batter is *in front of* anyone whose outline overlaps hers
- the first and last frames are covered

Then check the batter's own identifying details, such as her name or team
on her jersey. These are allowed only if publication consent covers them.

## Approval (exact procedure)

Create `demo-export/privacy/approvals.json`. It is gitignored and local
only; a fictional example:

```json
{
  "approvals": [
    {
      "clip": "ab2_swingmiss",
      "outputSha256": "<output_sha256 from ab2_swingmiss.summary.json>",
      "decision": "approve",
      "reviewedBy": "<your name>",
      "reviewedAt": "2026-09-24",
      "resolvedReviewItems": true,
      "notes": "Frames 1-17: spectators behind the batter, fully obscured."
    }
  ]
}
```

- **An approval is bound to that exact file.** Re-running the anonymizer
  produces a new hash, and the old approval no longer matches.
- **`resolvedReviewItems: true` is required** whenever the status is
  NEEDS_MANUAL_REVIEW or the validator reported findings.
- **A REJECT can't be approved.**
- **Point the manifest at the treated media.** In `demo-curation.<player>.json`,
  set `privacyApprovals`, `privacyDir`, and each clip's
  `privacy: { "name": "<clip>" }`. `mediaPolicy` defaults to
  `"privacy-treated"`.
- **Trim must match the analysis window.** It must start at
  `analysisWindowStartS` (the treated file *is* the analysis window). The
  gate checks this, so phase markers can't be misaligned.

## What enforces it

- **Exporter:** `src/services/demoExport/privacy.ts`,
  `evaluatePrivacyGate()`, 11 tests. It refuses any clip without a
  summary, without a validation report, with a hash mismatch against
  either report, without an approval for that exact hash, or with a
  frame-count mismatch. It also refuses REJECT, validator FAIL, a trim
  that doesn't start at the analysis window, and the original recording
  itself. Treated media is copied byte for byte and never re-encoded.
  Untreated `raw-transcode` media is allowed only in local-validation
  manifests.
- **Website sync:** `scripts/sync-hitterloop-demo.mjs --media`, in the
  website repo. It refuses:
  - any `media-manifest.json` whose `mediaPolicy` isn't `privacy-treated`
  - any file whose privacy record isn't `publishable`
  - anything without a human approval, anything REJECTED, or anything the
    validator FAILED
  - a file that isn't the validated treated output, or that is the
    original
  - a local-validation (unconsented) export

  All checks run before the destructive clean copy, so a refused run
  changes nothing.
- **Frontend:** the demo only ever plays `<basePath>media/<file>` from the
  fixture's `demo_media_path`. Original-footage URLs 404, and every seek
  lands inside the intended frame. The 1 ms seek epsilon fixes a
  container-timestamp rounding issue that showed the previous frame.
- **Tests:**
  - `scripts/privacy/test_privacy.py` (8): identity breaks, masks
    (including a bystander beside the bat), detail destruction, and end
    to end: frame count, fps, every frame in order, subject kept, rest
    destroyed.
  - `src/services/demoExport/privacy.test.ts` (11)
  - `coach/components/demoBanner.test.mjs`: playback path, offset at every
    seek site, and the seek epsilon.

## Commands

```bash
# per clip (pose3d venv); VIDEO = the exact video the pipeline analyzed
.venv_pose3d/Scripts/python.exe scripts/privacy/anonymize_clip.py --video VIDEO \
  --pose2d frames/<p>/<clip>/pose_2d.json --bat frames/<p>/<clip>/bat_path.json \
  --metrics frames/<p>/<clip>/metrics.json --out-dir demo-export/privacy --name <clip>
.venv_pose3d/Scripts/python.exe scripts/privacy/validate_privacy.py --source VIDEO \
  --output demo-export/privacy/<clip>.mp4 --pose2d ... --bat ... --metrics ... \
  --summary-out demo-export/privacy/<clip>.validation.json
.venv_pose3d/Scripts/python.exe scripts/privacy/review_findings.py --source VIDEO \
  --output demo-export/privacy/<clip>.mp4 --frames-json demo-export/privacy/<clip>.frames.json \
  --pose2d ... --validation-json demo-export/privacy/<clip>.validation.json \
  --out demo-export/privacy/review/<clip>.findings.jpg
# jersey-lettering OCR (OCR venv); run on VIDEO (baseline) and on the output
.venv_ocr/Scripts/python.exe scripts/privacy/ocr_check.py --video demo-export/privacy/<clip>.mp4   --pose2d ... --words <WORD1> <WORD2> --out demo-export/privacy/ocr/<clip>.output.json
# lettering review sheet (LOCAL ONLY - shows the unobscured source beside the output)
.venv_pose3d/Scripts/python.exe scripts/privacy/review_lettering.py --source VIDEO   --output demo-export/privacy/<clip>.mp4 --pose2d ...   --ocr-source demo-export/privacy/ocr/<clip>.source.json --out demo-export/privacy/review/<clip>.lettering.jpg
# identity audit (LOCAL ONLY - draws on unobscured frames)
.venv_pose3d/Scripts/python.exe scripts/privacy/audit_subject.py --video VIDEO --pose2d ... --bat ... --out <jpg> --name <clip>
```

## Known limits

- **Depth is unknown.** When another person's head overlaps the batter's
  outline, a human must confirm the batter is in front.
- **Detectors at 1920 and 2560 px** still find nothing that is fully
  hidden behind the batter. The keep region is kept tight for that reason.
- **The batter's jersey number** on the back is covered by the band when
  it's near the shoulders, not guaranteed lower down. The name bar, team
  lettering and helmet decal are masked (see above). Other identifying items, such as a
  helmet decal or bat-bag text, rely on the OCR pass and human review.
- **The public site's domain** is outside this pipeline. Whether a URL can
  reveal the family name is a publication decision.
