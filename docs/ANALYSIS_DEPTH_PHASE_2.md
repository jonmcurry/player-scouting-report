# Analysis depth Phase 2: capture implementation

Phase 2 adds private capture evidence without changing the automatic family finding rules. Migrations 00055 and 00056 must be applied together before the upload worker or the new client RPCs use them. Neither migration was deployed in this session.

## Profiles and capture state

- `game_backstop` and `open_side_practice` are enabled, versioned capture definitions. `unknown_imported` preserves existing and uncertain uploads. `catcher_view_practice` is disabled pending safety and validation review. Multi-angle and calibration were not added.
- Upload camera view is optional. The original declaration and later coach corrections are append-only. The recorded inference remains separate and currently states `unknown_imported` / `unavailable`; game versus practice never guesses a camera angle.
- The upload worker stores decoded media dimensions, rotation, orientation, duration, reported frame rate, and frame-count-over-duration rate. It samples frames for only extreme possible lighting, softness, and camera-motion issues. These proxies do not certify good lighting, sharpness, or a fixed camera.
- The full assessment records detected body and bat visibility at each available pipeline phase. A missing phase or detection remains unavailable. The existing batter-track fallback marks possible primary-athlete ambiguity. Fence, catcher, and umpire causes remain unavailable because the current detector does not identify them. Generic tracking loss is recorded separately.
- No device identifier, camera serial number, EXIF location, or raw media path is stored in capture assessments. A reusable setup fingerprint stays null until geometry can be checked without guessing.
- The player-scoped summary returns pending, media-only, checked, or needs-recheck state with no source hash or diagnostic metadata. Coach correction requires reassessment before camera-dependent comparisons. Existing family uploads remain valid if capture checks fail.

## Availability

`captureAvailability` evaluates a measurement definition separately against its validation status, confirmed profile, required phase landmarks, and supported media thresholds. Unknown checks fail closed. No profile is calibrated, and no capture-specific measurement has been validated or unlocked by Phase 2. Numeric comparisons across backstop and side views remain unavailable.

## Verification still needed before release

- Run both local Supabase integration suites after starting a local instance with migrations through 00056. They cover role boundaries, immutable records, and clip-deletion cascade.
- Inspect rendered game/backstop, open-side, optional selection, pending, partial, checked, needs-recheck, and correction screens at phone width with authenticated coach and guardian data.
- Validate the visual proxies and phase visibility against representative baseball and softball clips, including fences, overlapping people, darkness, and changing exposure, before using them for claims beyond possible filming suggestions.
