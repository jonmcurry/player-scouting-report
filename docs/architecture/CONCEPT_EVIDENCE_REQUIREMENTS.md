# Concept evidence requirements

Generated from CLAIM_REQUIREMENTS. Status: proposed; D7 review pending. No approvals exist.
Contact is not universal. Event groups are ANDed; alternatives inside each group are ORed.
Rationale text comes only from implementation plan section 3.2; absent rationales await the reviewer.
SYNTHETIC diagrams illustrate proposed requirement completeness only, never biomechanical truth or display authorization.
All examples are text; no media or athletes. Visibility and camera constraints must also hold.
Sequence-bound event substitutions are not approved. Baseline produces no swing_launch or stride_foot_lift.

| Concept | Required events (AND of OR groups) | Images | Min sequence frames | Visibility | Camera restriction | Disabled reason | Requirement SHA-256 |
|---|---|---|---:|---|---|---|---|
| contact | (impact_estimate OR contact_confirmed) | still_zoom | 2 | {"batter":true,"bat":0.5} | no additional restriction | none | 3eff4862ff0a8a34c814bd7c3997d7dd76ff7228b8cd0696deb3ce21ae1f3c6d |
| extension | (impact_estimate OR contact_confirmed) AND (extension) | sequence_extension_zoom | 8 | {"arms":true} | no additional restriction | none | 64bea0aafd3c3c8afc6a8ca155fb1b55c4f2fe0c8329a3f28ac899a10aece8f8 |
| load | (load_start) AND (swing_launch) | sequence | 2 | {"hands":true} | no additional restriction | none | dc2d12de6d9ba3de220e4c24c6815635f41ead940aa35edcc7354acbf29ee760 |
| stride_plant | (foot_plant OR stride_foot_lift) | sequence | 2 | {"feet":0.8} | no additional restriction | none | 0ff8515d061598222e1a6a0369f03d648408856e7eb777c80c0339a20ef40bdd |
| hand_path | (swing_launch) AND (impact_estimate OR contact_confirmed) | sequence | 2 | {"bat":0.5} | no additional restriction | none | b863af039cf3bfc191ccd1e2e44e0c8bcfd6058f2576d29898731740dbdc4863 |
| barrel_path | (swing_launch) AND (impact_estimate OR contact_confirmed) | sequence | 2 | {"bat":0.5} | no additional restriction | none | 68f0726f8026fa690468cfdce6128b6225f8006067f8310b52e2b32c3d0c6fc1 |
| barrel_depth | (swing_launch) AND (impact_estimate OR contact_confirmed) | sequence | 2 | {"bat":0.5} | no additional restriction | none | d01ad78bf0301a9dfade16073f8cf3b633fab484da38a5ab2895800ebb68571f |
| head_visual_stability | (swing_launch) AND (impact_estimate) | sequence | 2 | {"head":0.8} | no additional restriction | none | 0195dce8e354d6993cccd5516fb362b4d1e20f0cebd7a5a40592db42db7dba84 |
| finish_balance | (finish) | still_or_sequence | 2 | {"lower_body":true} | no additional restriction | none | 078d7a84c15aaf871b51aef7b950fbda1f48d719e2a41870ec81fb1b609238a7 |
| front_side_stability | (foot_plant) AND (impact_estimate) | sequence | 2 | {"torso":true,"lead_leg":true} | no additional restriction | none | 928f79edab0172e273652e2a242c572f2547879eb7eebb40f8d581a8eaf2487f |
| posture | (foot_plant) AND (impact_estimate) | sequence | 2 | {"torso":true,"lead_leg":true} | no additional restriction | none | 136cf91463e4dad48887fb1547249c636fb7e50c88ca0ab86582e586b7eb54fe |
| hip_shoulder_sequencing | none | none | 2 | {} | [] | depth_dominated_unapproved | 41aa5bce7f9a0370f0a64ff173bff0ac4d7938708a7c16aef442660cff8724b6 |
| stance_setup | (stance_set) | still | 2 | {} | no additional restriction | stance_detector_unmeasured | 3e86babe7cff589e16e058591ea05add2fdc250e145200c9117da3f41537b1f2 |
| timing | none | none | 2 | {} | no additional restriction | pitch_timing_unobservable | 863f2e36b41564a7b4bb86a22fbf1ce5fdc61462e1efa9008b95eea19bde04b8 |
| swing_decision | none | none | 2 | {} | no additional restriction | not_mechanical | 511918de2ee6ae6331d6ca3747bdbb1d061c652ce1751c5daba1eb8f231ec925 |
| pitch_location_adjustment | none | none | 2 | {} | no additional restriction | not_mechanical | dded8e86f1118fbdd703aa5a7cb2f3a1d9ba37b96ec1de1a5770d02ee9d9f648 |
| game_approach | none | none | 2 | {} | no additional restriction | not_mechanical | 3ecbdc2ffcbd9a43ff3def2aa6552245abcde2f4acf0f86ebcbfd7db7714dfad |

## contact

Rationale: Rationale pending reviewer (D7)

Status: proposed — no approval recorded (D7 pending)

```text
SYNTHETIC sufficient evidence example:
events: [impact_estimate]
frames: [f0]
supplied: still_zoom; required events covered; visibility: {"batter":true,"bat":0.5}; camera: unrestricted
SYNTHETIC insufficient evidence example:
[missing impact_estimate] -> [frame] => required event group unsatisfied (all its alternatives absent).
```

## extension

Rationale: Rationale pending reviewer (D7)

Status: proposed — no approval recorded (D7 pending)

```text
SYNTHETIC sufficient evidence example:
events: [impact_estimate] -> [extension]
frames: [f0] -> [f1] -> [f2] -> [f3] -> [f4] -> [f5] -> [f6] -> [f7]
supplied: sequence_extension_zoom; required events covered; visibility: {"arms":true}; camera: unrestricted
SYNTHETIC insufficient evidence example:
[missing impact_estimate] -> [frame] => required event group unsatisfied (all its alternatives absent).
```

## load

Rationale: Rationale pending reviewer (D7)

Status: proposed — no approval recorded (D7 pending)

```text
SYNTHETIC sufficient evidence example:
events: [load_start] -> [swing_launch]
frames: [f0] -> [f1]
supplied: sequence; required events covered; visibility: {"hands":true}; camera: unrestricted
SYNTHETIC insufficient evidence example:
[missing load_start] -> [frame] => required event group unsatisfied (all its alternatives absent).
```

## stride_plant

Rationale: Rationale pending reviewer (D7)

Status: proposed — no approval recorded (D7 pending)

```text
SYNTHETIC sufficient evidence example:
events: [foot_plant]
frames: [f0] -> [f1]
supplied: sequence; required events covered; visibility: {"feet":0.8}; camera: unrestricted
SYNTHETIC insufficient evidence example:
[missing foot_plant] -> [frame] => required event group unsatisfied (all its alternatives absent).
```

## hand_path

Rationale: Rationale pending reviewer (D7)

Status: proposed — no approval recorded (D7 pending)

```text
SYNTHETIC sufficient evidence example:
events: [swing_launch] -> [impact_estimate]
frames: [f0] -> [f1]
supplied: sequence; required events covered; visibility: {"bat":0.5}; camera: unrestricted
SYNTHETIC insufficient evidence example:
[missing swing_launch] -> [frame] => required event group unsatisfied (all its alternatives absent).
```

## barrel_path

Rationale: Rationale pending reviewer (D7)

Status: proposed — no approval recorded (D7 pending)

```text
SYNTHETIC sufficient evidence example:
events: [swing_launch] -> [impact_estimate]
frames: [f0] -> [f1]
supplied: sequence; required events covered; visibility: {"bat":0.5}; camera: unrestricted
SYNTHETIC insufficient evidence example:
[missing swing_launch] -> [frame] => required event group unsatisfied (all its alternatives absent).
```

## barrel_depth

Rationale: Rationale pending reviewer (D7)

Status: proposed — no approval recorded (D7 pending)

```text
SYNTHETIC sufficient evidence example:
events: [swing_launch] -> [impact_estimate]
frames: [f0] -> [f1]
supplied: sequence; required events covered; visibility: {"bat":0.5}; camera: unrestricted
SYNTHETIC insufficient evidence example:
[missing swing_launch] -> [frame] => required event group unsatisfied (all its alternatives absent).
```

## head_visual_stability

Rationale: Rationale pending reviewer (D7)

Status: proposed — no approval recorded (D7 pending)

```text
SYNTHETIC sufficient evidence example:
events: [swing_launch] -> [impact_estimate]
frames: [f0] -> [f1]
supplied: sequence; required events covered; visibility: {"head":0.8}; camera: unrestricted
SYNTHETIC insufficient evidence example:
[missing swing_launch] -> [frame] => required event group unsatisfied (all its alternatives absent).
```

## finish_balance

Rationale: Rationale pending reviewer (D7)

Status: proposed — no approval recorded (D7 pending)

```text
SYNTHETIC sufficient evidence example:
events: [finish]
frames: [f0] -> [f1]
supplied: still_or_sequence; required events covered; visibility: {"lower_body":true}; camera: unrestricted
SYNTHETIC insufficient evidence example:
[missing finish] -> [frame] => required event group unsatisfied (all its alternatives absent).
```

## front_side_stability

Rationale: Rationale pending reviewer (D7)

Status: proposed — no approval recorded (D7 pending)

```text
SYNTHETIC sufficient evidence example:
events: [foot_plant] -> [impact_estimate]
frames: [f0] -> [f1]
supplied: sequence; required events covered; visibility: {"torso":true,"lead_leg":true}; camera: unrestricted
SYNTHETIC insufficient evidence example:
[missing foot_plant] -> [frame] => required event group unsatisfied (all its alternatives absent).
```

## posture

Rationale: Rationale pending reviewer (D7)

Status: proposed — no approval recorded (D7 pending)

```text
SYNTHETIC sufficient evidence example:
events: [foot_plant] -> [impact_estimate]
frames: [f0] -> [f1]
supplied: sequence; required events covered; visibility: {"torso":true,"lead_leg":true}; camera: unrestricted
SYNTHETIC insufficient evidence example:
[missing foot_plant] -> [frame] => required event group unsatisfied (all its alternatives absent).
```

## hip_shoulder_sequencing

Rationale: depth-dominated from backstop view; revisit per capture profile in Stage 2

Status: proposed — no approval recorded (D7 pending)

```text
SYNTHETIC sufficient evidence example:
[frame] -> [frame] => NONE: concept disabled; no sufficient example exists.
SYNTHETIC insufficient evidence example:
[frame] -> [frame] => withheld: disabled regardless of frames.
```

## stance_setup

Rationale: not eligible until the stance detector is measured (find_stance_frame known to mislocate)

Status: proposed — no approval recorded (D7 pending)

```text
SYNTHETIC sufficient evidence example:
[frame] -> [frame] => NONE: concept disabled; no sufficient example exists.
SYNTHETIC insufficient evidence example:
[frame] -> [frame] => withheld: disabled regardless of frames.
```

## timing

Rationale: pitch timing not observable

Status: proposed — no approval recorded (D7 pending)

```text
SYNTHETIC sufficient evidence example:
[frame] -> [frame] => NONE: concept disabled; no sufficient example exists.
SYNTHETIC insufficient evidence example:
[frame] -> [frame] => withheld: disabled regardless of frames.
```

## swing_decision

Rationale: not mechanical

Status: proposed — no approval recorded (D7 pending)

```text
SYNTHETIC sufficient evidence example:
[frame] -> [frame] => NONE: concept disabled; no sufficient example exists.
SYNTHETIC insufficient evidence example:
[frame] -> [frame] => withheld: disabled regardless of frames.
```

## pitch_location_adjustment

Rationale: not mechanical

Status: proposed — no approval recorded (D7 pending)

```text
SYNTHETIC sufficient evidence example:
[frame] -> [frame] => NONE: concept disabled; no sufficient example exists.
SYNTHETIC insufficient evidence example:
[frame] -> [frame] => withheld: disabled regardless of frames.
```

## game_approach

Rationale: not mechanical

Status: proposed — no approval recorded (D7 pending)

```text
SYNTHETIC sufficient evidence example:
[frame] -> [frame] => NONE: concept disabled; no sufficient example exists.
SYNTHETIC insufficient evidence example:
[frame] -> [frame] => withheld: disabled regardless of frames.
```
