# BarrelIQ pipeline audit (2026-09-19)

## Existing implementation

- Ingestion: `coach/components/videoUpload.js` obtains an authenticated GCS upload URL, writes a `video_clips` queue row, and the Node worker downloads the private object.
- Jobs/storage: `src/cli/processUploadQueue.ts`, `src/services/db/uploadQueue.ts`, `src/services/storage/gcs.ts`; atomic queue claims, stale-claim recovery, GCS raw storage, Supabase derived data.
- Detection/tracking: `scripts/pose3d/detect_2d.py`; YOLO11m-pose, YOLOv8m COCO bat class, ByteTrack for bat IDs, whole-clip person tracks ranked by repeated wrist/bat evidence.
- Temporal cleanup: 2D One Euro filtering; confidence gates and model interpolation during lift. Post-lift One Euro filtering and median-length rigidification exist in TypeScript ingestion.
- Swing localization: optional audio onset pre-pass, then bat speed + knee extension + rotation activity. It can honestly return no contact.
- 3D: VideoPose3D (COCO-17 to H36M-17), depth correction using confident 2D reprojection, fixed display-level orientation correction, root-relative uncalibrated units.
- Rendering: Three.js, named Mixamo FBX bones, quaternion/direction retargeting, OrbitControls, synthetic bat attached to both hands, neutral ground.
- Clients: static PWA in `coach/`; Capacitor Android shell in `mobile/` serves the same app.
- AI/review: Gemini or local Claude draft path, checklist/issue drafts retain `reviewed_by`; coach writes are authoritative and protected against automated overwrite.
- Data/security: migrations 00001-00024; team-scoped RLS on clips, pose, metrics and phases; reference tables read-only; service-role worker writes.
- Tests/deployment: Node tests for DB safety; Docker/local Supabase/GCS; Android Gradle/Capacitor scripts. Reconstruction math coverage was missing before this change.

## Findings

What works: private ingestion and queueing, correct-batter selection on the four short validation clips, pose coverage, bat detections, VideoPose3D output, coach draft protection, and an actual rigged FBX renderer.

What was unstable: optional `ffprobe`/`ffmpeg` stages crashed when binaries were absent; raw global 3D orientation can be almost sideways; bone lengths varied 2.4-10.1% coefficient-of-variation; the viewer lacked named camera presets/frame steps; model/version/quality diagnostics were fragmented.

What was missing: a repeatable validation batch, hash IDs, structured quality results, separate diagnostic videos, canonical coordinate contract, observation statuses, explicit direct-vs-reconstructed metric labels, foot-plant stabilization, private original-video read URLs, and tests for core reconstruction math.

What prevents laboratory trust: monocular footage has no camera intrinsics/extrinsics or scale, VideoPose3D was not trained specifically for softball, bat boxes do not provide calibrated 3D endpoints, H36M lacks feet/toes and hand detail, and contact is usually an estimate. The experience is therefore designed to preserve timing and gross pose for explanation, not exact biomechanics.

## Canonical reconstruction flow

Private original video → whole-clip athlete/bat tracking → confidence-aware 2D cleanup → normalized COCO sequence → pluggable lifter boundary (current: VideoPose3D) → depth correction → one rigid early-stance leveling transform → median bone-length constraint → low-velocity foot-plant correction → named Mixamo quaternion retargeting → shared frame-index timeline → original-video/3D coach review.

Canonical BarrelIQ coordinates are X=batter left/right, Y=vertical, Z=toward pitcher. Conversion from the lifter happens once; Three.js changes handed display depth once. Absolute scale defaults to normalized H36M/body units unless athlete height or camera calibration is supplied.
