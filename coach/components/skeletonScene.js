// Real WebGL 3D swing renderer (Three.js). Drives a real rigged humanoid
// character mesh (coach/assets/models/batter.fbx - a Mixamo-rigged skinned
// character the user sourced) from the pose3d pipeline's real tracked 17
// H36M joints via bone retargeting, replacing the earlier primitive-capsule
// mannequin (which was rejected as looking amateurish, then a flat-silhouette
// pass was also rejected in favor of an actual character model).
//
// Vendoring note: Three.js + loaders imported from esm.sh (pinned version),
// matching the same CDN-import pattern shared.js already uses for
// @supabase/supabase-js. Added to sw.js's runtime CDN_CACHE (not the
// install-time precache - see sw.js's own comment on why).
import * as THREE from "https://esm.sh/three@0.185.1";
import { OrbitControls } from "https://esm.sh/three@0.185.1/examples/jsm/controls/OrbitControls.js";
import { FBXLoader } from "https://esm.sh/three@0.185.1/examples/jsm/loaders/FBXLoader.js";
import { clone as cloneSkinned } from "https://esm.sh/three@0.185.1/examples/jsm/utils/SkeletonUtils.js";
import {
  H36M_JOINT_NAMES, L_SHOULDER, R_SHOULDER, L_HIP, R_HIP, THORAX,
  L_WRIST, R_WRIST, L_ELBOW, R_ELBOW, L_KNEE, R_KNEE, L_ANKLE, R_ANKLE,
} from "./h36mSkeleton.js";
import { AVATAR_RETARGET_MAP } from "./avatar-retarget-map.js";

export const DEFAULT_COLORS = {
  body: 0xcbb89a,
  bat: 0x8a5a2b,
  contact: 0xe0b000,
};

// Resolved relative to THIS module's own URL, not the page's - a plain
// page-relative string would break when this module is imported from
// coach/dev/skeleton-test.html (one directory deeper than coach/player.html).
const CHARACTER_URL = new URL("../assets/models/batter.fbx", import.meta.url).href;

// data joints are [x, y, z] with z "up" (see scripts/pose3d/lift_3d.py's
// module docstring). Three.js is Y-up, so this is the one place the axis
// remap happens: world X = data X, world Y (up) = data Z, world Z (depth) =
// -data Y. Everything downstream works in plain Three.js world space.
function toVec3(p) {
  return new THREE.Vector3(p[0], p[2], -p[1]);
}

// --- Retargeting bone map -----------------------------------------------
// Mixamo bone names as they appear in THIS specific FBX export (no colon
// separator - confirmed by loading it and listing bone names, not assumed;
// some Mixamo exports use "mixamorig:Hips", this one uses "mixamorigHips").
const MB = {
  hips: AVATAR_RETARGET_MAP.pelvis,
  spine: AVATAR_RETARGET_MAP.spine, spine1: "mixamorigSpine1", spine2: AVATAR_RETARGET_MAP.chest,
  neck: AVATAR_RETARGET_MAP.neck, head: AVATAR_RETARGET_MAP.head, headTop: "mixamorigHeadTop_End",
  lShoulder: AVATAR_RETARGET_MAP.leftShoulder, lArm: AVATAR_RETARGET_MAP.leftUpperArm, lForeArm: AVATAR_RETARGET_MAP.leftForearm, lHand: AVATAR_RETARGET_MAP.leftHand,
  rShoulder: AVATAR_RETARGET_MAP.rightShoulder, rArm: AVATAR_RETARGET_MAP.rightUpperArm, rForeArm: AVATAR_RETARGET_MAP.rightForearm, rHand: AVATAR_RETARGET_MAP.rightHand,
  lUpLeg: AVATAR_RETARGET_MAP.leftThigh, lLeg: AVATAR_RETARGET_MAP.leftShin, lFoot: AVATAR_RETARGET_MAP.leftFoot,
  rUpLeg: AVATAR_RETARGET_MAP.rightThigh, rLeg: AVATAR_RETARGET_MAP.rightShin, rFoot: AVATAR_RETARGET_MAP.rightFoot,
};

// Hierarchy, parent-first (retargeting must process a bone AFTER its
// parent's new world orientation is known). `null` parent = character root.
const BONE_CHAIN = [
  ["hips", null],
  ["spine", "hips"], ["spine1", "spine"], ["spine2", "spine1"],
  ["neck", "spine2"], ["head", "neck"], ["headTop", "head"],
  ["lShoulder", "spine2"], ["lArm", "lShoulder"], ["lForeArm", "lArm"], ["lHand", "lForeArm"],
  ["rShoulder", "spine2"], ["rArm", "rShoulder"], ["rForeArm", "rArm"], ["rHand", "rForeArm"],
  ["lUpLeg", "hips"], ["lLeg", "lUpLeg"], ["lFoot", "lLeg"],
  ["rUpLeg", "hips"], ["rLeg", "rUpLeg"], ["rFoot", "rLeg"],
];

// Simple single-vector "aim" retargeting: this bone's rotation is driven by
// aligning its OWN rest-pose direction (toward `restChild`) with the real
// tracked direction between the two named H36M joints. No twist reference -
// H36M gives us no forearm/shin rotation-about-its-own-axis data, so leaving
// twist at whatever the rest pose has is the honest choice, not a guess.
// Bones not listed here (spine1, spine2, neck, head, lHand, rHand, lFoot,
// rFoot, headTop) are deliberately left at their REST local rotation -
// either because H36M has no corresponding joint (fingers, toes - H36M-17
// has no foot joints at all), because the rotation is already fully
// accounted for by a parent bone (spine1/spine2 stay rigid relative to
// spine, matching H36M's own single hip->thorax segment assumption), or -
// neck/head specifically - because the underlying data isn't reliable
// enough to render at all (see below).
//
// neck/head were retargeted from the raw NECK->HEAD / HEAD->HEAD_TOP H36M
// vectors until a real, measured investigation found those two joints
// specifically are a much weaker signal than every other joint this
// pipeline renders: a real checkpoint frame measured 115deg-from-vertical
// for neck->head (the head reading as thrown backward, confirmed visually
// broken in the live app), and a full 2D-reprojection fix - the exact
// technique that successfully fixed the wrist/bat-grip and shoulder-width
// bugs elsewhere in this file - was tried and DISPROVED by direct A/B
// evidence rather than assumed to help: on the one checkpoint frame with
// the best available 2D tracking (where the correction actually fires), it
// made the angle WORSE (98deg, still visibly wrong); on every other
// checkpoint frame, where 2D confidence was too low to trigger the
// correction at all, the model's own raw estimate already looked more
// reasonable (45-68deg) - a decisive signal the reprojection technique
// itself doesn't generalize to the head, not a data-quality problem to
// chase further (scripts/pose3d/correct_limb_depth.py's LIMB_CHAIN
// deliberately does NOT include head, matching this decision).
//
// Only 1 of this app's 11 checklist checkpoints (`head-eyes`) evaluates
// head/eye position at all, and it doesn't render the real 3D model today
// (Tier 3/illustration-only, compModal.js) - so for every checkpoint that
// DOES render this model, head orientation was never load-bearing for what
// a coach is actually judging. Leaving neck/head untouched means the head
// rides along with spine2's own real, already-trusted orientation (genuine
// torso lean/rotation from reliable tracked data) instead of independently
// rendering noisy per-frame joint data - it still leans forward with a real
// forward lean at contact, it just can no longer swing into an anatomically
// impossible "looking backward" pose on its own. A neutral head beats a
// confidently wrong one.
//
// lShoulder/rShoulder ARE retargeted (a real fix, not always true here) -
// leaving them at rest was a real, measured bug: the Mixamo character's own
// rest-pose shoulder separation is a fraction of Emily's real tracked
// shoulder width (confirmed directly via live bone-position dumps: ~0.084
// world units retargeted vs. ~0.21 in the real tracked data, less than
// half), because nothing upstream of lArm/rArm ever re-aims the clavicle
// itself toward where her real shoulders actually are - the whole arm chain
// was hanging off anchor points narrower than her real proportions,
// independent of and compounding on top of the leveling-angle bug above.
// THORAX->shoulder is the best available proxy for "clavicle direction"
// H36M-17 offers (no separate clavicle-root landmark exists).
const AIM_RETARGET = {
  lShoulder: { child: "lArm", from: THORAX, to: L_SHOULDER },
  lArm: { child: "lForeArm", from: L_SHOULDER, to: L_ELBOW },
  lForeArm: { child: "lHand", from: L_ELBOW, to: L_WRIST },
  rShoulder: { child: "rArm", from: THORAX, to: R_SHOULDER },
  rArm: { child: "rForeArm", from: R_SHOULDER, to: R_ELBOW },
  rForeArm: { child: "rHand", from: R_ELBOW, to: R_WRIST },
  lUpLeg: { child: "lLeg", from: L_HIP, to: L_KNEE },
  lLeg: { child: "lFoot", from: L_KNEE, to: L_ANKLE },
  rUpLeg: { child: "rLeg", from: R_HIP, to: R_KNEE },
  rLeg: { child: "rFoot", from: R_KNEE, to: R_ANKLE },
};

function orthoBasisQuat(aim, rightHint) {
  const up = aim.clone().normalize();
  const forward = new THREE.Vector3().crossVectors(rightHint, up).normalize();
  const right = new THREE.Vector3().crossVectors(up, forward).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, forward));
}

// Tapered bat profile (radius, distance-from-knob-along-axis) - lathed into
// a real solid; the character asset has no bat prop of its own.
const BAT_PROFILE = [
  [0.0, 0.0], [0.014, 0.005], [0.02, 0.015], [0.013, 0.05], [0.014, 0.32],
  [0.02, 0.52], [0.03, 0.65], [0.032, 0.7], [0.028, 0.73], [0.0, 0.745],
];
function buildBatMesh(mat) {
  const points = BAT_PROFILE.map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.Mesh(new THREE.LatheGeometry(points, 14), mat);
}

// Real target height (meters) every clone gets rescaled to. Not this
// particular tracked player's real height (unknown/irrelevant - the
// character's proportions are independent of whoever was filmed) - just a
// reasonable, CONSISTENT scale so the bat/ground/contact-ring constants
// below (all authored assuming roughly meter-scale) stay meaningful,
// instead of introducing a second unit system just for the character mesh.
const TARGET_HEIGHT_M = 1.65;

// Module-level cache: fetch+parse the (~2MB) character FBX exactly once per
// page load, no matter how many scenes get created (each real comparison
// view needs its own independent clone - a two-panel view needs two).
// Also measures the asset's native scale ONCE here - confirmed empirically
// this specific export is ~181 native units tall (Mixamo FBX are typically
// authored in centimeters), not assumed, since a different sourced asset
// could use a different native scale entirely.
let characterTemplatePromise = null;
function loadCharacterTemplate() {
  if (!characterTemplatePromise) {
    characterTemplatePromise = new Promise((resolve, reject) => {
      new FBXLoader().load(
        CHARACTER_URL,
        (obj) => {
          obj.updateMatrixWorld(true);
          const bbox = new THREE.Box3().setFromObject(obj);
          const nativeHeight = Math.max(0.001, bbox.max.y - bbox.min.y);
          resolve({ template: obj, scale: TARGET_HEIGHT_M / nativeHeight });
        },
        undefined,
        reject,
      );
    });
  }
  return characterTemplatePromise;
}

/**
 * @param {HTMLCanvasElement} canvasEl
 * @param {{colors?: object, drawBat?: boolean, drawGround?: boolean}} [opts]
 * @returns {Promise<object>} async - loading a real character mesh takes a
 *   real network fetch, unlike the old primitive-only renderer which could
 *   build synchronously. Callers must await this.
 */
export async function createSkeletonScene(canvasEl, opts = {}) {
  const colors = { ...DEFAULT_COLORS, ...(opts.colors || {}) };
  const drawBat = opts.drawBat !== false;
  const drawGround = opts.drawGround !== false;

  let levelCorrection = new THREE.Quaternion();
  const worldVec3 = (p) => toVec3(p).applyQuaternion(levelCorrection);

  const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 50);

  scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  const key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.position.set(1.6, 2.6, 1.8);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.3);
  fill.position.set(-1.4, 0.8, 2.0);
  scene.add(fill);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.minDistance = 0.5;
  controls.maxDistance = 10;
  // Bounds tightened from an earlier 0.12-0.85 range (~22 degrees off either
  // pole) after a real, confirmed bug report: a coach dragging the Tier-2
  // comparison view (compModal.js) far enough to hit that old limit put the
  // camera near top-down, where ANY standing human figure foreshortens into
  // a confusing blob - reproduced directly by dispatching a real drag on a
  // known-good, anatomically-valid frame (the reference AB11 clip's
  // Stance checkpoint, frame 65) and getting exactly the "bat sticking
  // straight up out of her head" look the coach screenshotted, with a drag
  // as small as 60px on a ~164px-tall canvas already saturating the old
  // clamp. Not a data/retargeting bug - purely a camera-angle range that let
  // a curious rotate reach an unhelpful view. New range (~50-104 degrees
  // from the top) still lets a coach tilt a real amount around the default
  // eye-ish-level view (Math.PI/2 - 0.17, ~80 degrees) without ever reaching
  // a foreshortening-degenerate angle.
  controls.minPolarAngle = Math.PI * 0.28;
  controls.maxPolarAngle = Math.PI * 0.58;
  controls.enablePan = false;

  let defaultCamera = { azimuth: -0.52, polar: Math.PI / 2 - 0.17, distance: 3, target: new THREE.Vector3(0, 1, 0) };
  function applyDefaultCamera() {
    const { azimuth, polar, distance, target } = defaultCamera;
    controls.target.copy(target);
    const sinPolar = Math.sin(polar);
    camera.position.set(
      target.x + distance * sinPolar * Math.sin(azimuth),
      target.y + distance * Math.cos(polar),
      target.z + distance * sinPolar * Math.cos(azimuth),
    );
    controls.update();
  }

  let groundMesh = null;
  if (drawGround) {
    groundMesh = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 32),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }),
    );
    groundMesh.rotation.x = -Math.PI / 2;
    scene.add(groundMesh);
  }

  // --- Load and clone the real character ---
  const { template, scale } = await loadCharacterTemplate();
  const character = cloneSkinned(template);
  character.scale.setScalar(scale);
  character.traverse((node) => {
    if (node.isMesh) {
      // Real texture wasn't included in this export (plain default material)
      // - apply a clean neutral tone rather than Mixamo's placeholder color,
      // shaded by the real lights above. A real uniform texture can replace
      // this material later without touching any retargeting code below.
      node.material = new THREE.MeshStandardMaterial({ color: colors.body, roughness: 0.75, metalness: 0.02 });
      node.frustumCulled = false; // retargeted pose can move the mesh well outside its original bind-pose bounding box
    }
  });
  scene.add(character);

  const bones = {};
  for (const [key2, mixamoName] of Object.entries(MB)) {
    const b = character.getObjectByName(mixamoName);
    if (!b) throw new Error(`skeletonScene: character asset is missing expected bone "${mixamoName}" - is this a Mixamo-rigged export?`);
    bones[key2] = b;
  }

  // Capture the REST (bind) pose once, before any retargeting - world
  // position of every bone, and the exact local quaternion `skeleton.pose()`
  // leaves untouched bones at (spine1/spine2/shoulders/hands/feet/headTop).
  character.updateMatrixWorld(true);
  const restPos = {};
  const restLocalQuat = {};
  const restWorldQuat = {};
  for (const [key2, bone] of Object.entries(bones)) {
    restPos[key2] = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
    restLocalQuat[key2] = bone.quaternion.clone();
    restWorldQuat[key2] = bone.getWorldQuaternion(new THREE.Quaternion());
  }

  // Character's own real size, from its bind-pose bounding box - camera
  // framing is based on the FIXED character geometry now, not the tracked
  // clip's motion extent (the character's size never changes, only its pose).
  const bbox = new THREE.Box3().setFromObject(character);
  const charHeight = Math.max(0.5, bbox.max.y - bbox.min.y);
  const charFloorY = bbox.min.y;

  // Hips' real parent world orientation (an "Armature"/root null above it
  // may have its own non-identity transform in this export) - captured
  // rather than assumed identity, since assuming wrong here would silently
  // misalign the ENTIRE retargeted skeleton relative to its true rest pose.
  const hipsParentWorldQuat = bones.hips.parent
    ? bones.hips.parent.getWorldQuaternion(new THREE.Quaternion())
    : new THREE.Quaternion();

  const worldQuat = {}; // scratch, recomputed every setJoints() call
  const tmpV1 = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();

  function retargetBones(v) {
    for (const [key2, parentKey] of BONE_CHAIN) {
      const bone = bones[key2];
      const parentWorld = parentKey ? worldQuat[parentKey] : hipsParentWorldQuat;

      if (key2 === "hips" || key2 === "spine") {
        // Full 2-vector (up + right) basis retargeting, not just single-
        // direction alignment - these two bones carry the swing's real
        // hip-shoulder separation (hips and spine rotating independently
        // about the vertical axis), which needs TWIST preserved, not just
        // tilt. up = toward the next segment up the body; right = the
        // hip-line (hips) or shoulder-line (spine) - each computed the same
        // way in both the character's rest pose and the real tracked data,
        // so the delta between them is a pure, comparable reorientation.
        const hipMid = v[L_HIP].clone().add(v[R_HIP]).multiplyScalar(0.5);
        const targetUp = v[THORAX].clone().sub(hipMid).normalize();
        const targetRight = key2 === "hips"
          ? v[R_HIP].clone().sub(v[L_HIP]).normalize()
          : v[R_SHOULDER].clone().sub(v[L_SHOULDER]).normalize();
        const restUp = key2 === "hips"
          ? restPos.spine.clone().sub(restPos.hips).normalize()
          : restPos.neck.clone().sub(restPos.spine).normalize();
        const restRight = key2 === "hips"
          ? restPos.rUpLeg.clone().sub(restPos.lUpLeg).normalize()
          : restPos.rShoulder.clone().sub(restPos.lShoulder).normalize();
        const qRest = orthoBasisQuat(restUp, restRight);
        const qTarget = orthoBasisQuat(targetUp, targetRight);
        const delta = qTarget.clone().multiply(qRest.clone().invert());
        const newWorld = delta.clone().multiply(restWorldQuat[key2]);
        const localQuat = parentWorld.clone().invert().multiply(newWorld);
        bone.quaternion.copy(localQuat);
        worldQuat[key2] = newWorld;
        continue;
      }

      const aim = AIM_RETARGET[key2];
      if (!aim) {
        // Untouched bone - local rotation stays at rest; world rotation
        // still changes because its parent's world rotation changed.
        bone.quaternion.copy(restLocalQuat[key2]);
        worldQuat[key2] = parentWorld.clone().multiply(restLocalQuat[key2]);
        continue;
      }

      const restAim = restPos[aim.child].clone().sub(restPos[key2]).normalize();
      const targetAim = v[aim.to].clone().sub(v[aim.from]).normalize();
      const delta = new THREE.Quaternion().setFromUnitVectors(restAim, targetAim);
      const newWorld = delta.clone().multiply(restWorldQuat[key2]);
      const localQuat = parentWorld.clone().invert().multiply(newWorld);
      bone.quaternion.copy(localQuat);
      worldQuat[key2] = newWorld;
    }
    character.updateMatrixWorld(true);
  }

  let batMesh = null;
  let contactRing = null;
  if (drawBat) {
    batMesh = buildBatMesh(new THREE.MeshStandardMaterial({ color: colors.bat, roughness: 0.45, metalness: 0.08 }));
    scene.add(batMesh);
    contactRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.045, 0.008, 8, 20),
      new THREE.MeshStandardMaterial({ color: colors.contact, emissive: colors.contact, emissiveIntensity: 0.6, roughness: 0.3 }),
    );
    contactRing.visible = false;
    scene.add(contactRing);
  }

  let initialized = false;
  let clipFramesRef = [];

  /** Called once per clip, before the first setJoints() - computes the
   * per-clip "auto-level" correction. This pipeline has no real camera
   * calibration (scripts/pose3d/lift_3d.py's WORLD_ROTATION is a single
   * fixed rotation borrowed from VideoPose3D's own demo/visualizer code,
   * which its own authors label visualization-only) - for some real camera
   * angles the resulting "vertical" axis is measurably wrong. Confirmed
   * directly against a real clip's overlay video (2D tracking accurate,
   * genuinely upright stance the whole time) vs. its reconstructed
   * torso_tilt_from_vertical_deg (48-65deg for the ENTIRE clip).
   *
   * Calibrates from only the FIRST ~20% of the clip's frames, not the whole
   * clip - a real, measured bug found while chasing a persistent "stance
   * doesn't look upright" report: averaging over every frame (stance through
   * follow-through) lets the swing's own genuine dynamic forward lean
   * (load/stride/contact/extension routinely lean 15-20+ deg past the
   * calibration clip's early portion) drag the "average up" direction away
   * from true vertical, which then gets baked into EVERY frame's correction
   * - including the genuinely-upright stance frame at the start. The
   * swing-locate pre-pass (scripts/pose3d/locate_swing.py) guarantees every
   * clip opens with real pre-swing stance/load time before the dynamic
   * swing takes over, so the early portion is a trustworthy "what does
   * upright look like on this uncalibrated camera" reference. Measured on a
   * real clip (reference AB11): full-clip calibration left the stance frame
   * ~6-7deg off vertical; first-20% calibration brought it under 1deg, while
   * correctly leaving contact/extension's real forward lean visible (~15-22
   * deg) instead of averaging it away. Same single rigid correction applied
   * to every frame either way, so real relative motion across the swing is
   * still fully preserved - only which frames choose the correction changed.
   * Display-only - does not touch stored video_clip_metrics angles, see
   * NEXT_STEPS.md. */
  function setClipFrames(frames) {
    clipFramesRef = frames;
    const calibrationFrames = frames.slice(0, Math.max(1, Math.ceil(frames.length * 0.2)));
    const avgUp = new THREE.Vector3();
    for (const f of calibrationFrames) {
      const j = f.joints;
      const hipMid = [
        (j[L_HIP][0] + j[R_HIP][0]) / 2,
        (j[L_HIP][1] + j[R_HIP][1]) / 2,
        (j[L_HIP][2] + j[R_HIP][2]) / 2,
      ];
      avgUp.add(toVec3(j[THORAX]).sub(toVec3(hipMid)).normalize());
    }
    avgUp.normalize();
    levelCorrection = avgUp.lengthSq() > 1e-6
      ? new THREE.Quaternion().setFromUnitVectors(avgUp, new THREE.Vector3(0, 1, 0))
      : new THREE.Quaternion();

    if (groundMesh) groundMesh.position.y = charFloorY;

    defaultCamera = {
      azimuth: -0.52,
      polar: Math.PI / 2 - 0.17,
      // Same FOV-fit formula as the primitive renderer used, now driven by
      // the character's own fixed height instead of the clip's motion span.
      distance: (charHeight * 1.5) / (2 * Math.tan((18 * Math.PI) / 180)),
      target: new THREE.Vector3(0, charFloorY + charHeight * 0.52, 0),
    };
    applyDefaultCamera();
    initialized = true;
  }

  /** @param {number[][]} joints - one frame's 17 [x,y,z] joints */
  function setJoints(joints, { highlightContact = false } = {}) {
    if (!initialized) setClipFrames([{ joints }]);
    const v = joints.map(worldVec3);
    retargetBones(v);

    if (batMesh) {
      const lHandPos = tmpV1.setFromMatrixPosition(bones.lHand.matrixWorld).clone();
      const rHandPos = tmpV2.setFromMatrixPosition(bones.rHand.matrixWorld).clone();
      const lForeArmPos = new THREE.Vector3().setFromMatrixPosition(bones.lForeArm.matrixWorld);
      const rForeArmPos = new THREE.Vector3().setFromMatrixPosition(bones.rForeArm.matrixWorld);
      const grip = lHandPos.clone().add(rHandPos).multiplyScalar(0.5);
      const leadDir = lHandPos.clone().sub(lForeArmPos).add(rHandPos.clone().sub(rForeArmPos));
      if (leadDir.lengthSq() > 1e-8) {
        leadDir.normalize();
        const knob = grip.clone().sub(leadDir.clone().multiplyScalar(0.045));
        batMesh.position.copy(knob);
        batMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), leadDir);
        batMesh.visible = true;
        if (contactRing) {
          contactRing.position.copy(grip);
          contactRing.quaternion.copy(batMesh.quaternion);
          contactRing.visible = !!highlightContact;
        }
      } else {
        batMesh.visible = false;
        if (contactRing) contactRing.visible = false;
      }
    }
    if (trailCfg.shoulderAxis || trailCfg.hipAxis) updateAxisOverlays();
  }

  // ---- Motion trails + axis overlays -------------------------------------
  // Coach-toggleable, deliberately short: a trail only covers the last
  // `windowFrames` frames up to the shown one (default ~0.3s at 30fps), so
  // nothing persistent ever piles up over the figure. Trail points are the
  // RETARGETED bone positions (the same positions the avatar is drawn at), not
  // raw joint coordinates - the avatar is rescaled to a fixed height, so raw
  // joint space would not line up with it. Each trail therefore re-runs the
  // (cheap) bone retarget for the window's frames, then restores the shown
  // frame. Bat barrel is the same knob->tip geometry the bat mesh uses.
  const TRAIL_COLORS = { hands: 0xf2b84b, bat: 0xe0584c, pelvis: 0x34d399, sternum: 0x6fa8ff };
  const MAX_TRAIL_FRAMES = 45;
  const trailCfg = { hands: false, bat: false, pelvis: false, sternum: false, shoulderAxis: false, hipAxis: false, windowFrames: 10 };
  const trailLines = {};
  for (const [name, color] of Object.entries(TRAIL_COLORS)) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array((MAX_TRAIL_FRAMES + 1) * 3), 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array((MAX_TRAIL_FRAMES + 1) * 3), 3));
    geo.setDrawRange(0, 0);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 2 }));
    line.frustumCulled = false;
    line.visible = false;
    line.userData.color = new THREE.Color(color);
    scene.add(line);
    trailLines[name] = line;
  }
  const axisLines = {};
  for (const name of ["shoulderAxis", "hipAxis"]) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: name === "shoulderAxis" ? 0x6fa8ff : 0x34d399 }));
    line.frustumCulled = false;
    line.visible = false;
    scene.add(line);
    axisLines[name] = line;
  }

  function bonePos(key) {
    return new THREE.Vector3().setFromMatrixPosition(bones[key].matrixWorld);
  }
  function batBarrelTip() {
    const lHand = bonePos("lHand");
    const rHand = bonePos("rHand");
    const dir = lHand.clone().sub(bonePos("lForeArm")).add(rHand.clone().sub(bonePos("rForeArm")));
    if (dir.lengthSq() < 1e-8) return null;
    dir.normalize();
    return lHand.add(rHand).multiplyScalar(0.5).add(dir.multiplyScalar(0.745 - 0.045));
  }
  const trailSamplers = {
    hands: () => bonePos("lHand").add(bonePos("rHand")).multiplyScalar(0.5),
    bat: batBarrelTip,
    pelvis: () => bonePos("hips"),
    sternum: () => bonePos("spine2"),
  };

  function updateAxisOverlays() {
    const set = (name, a, b, on) => {
      const line = axisLines[name];
      line.visible = !!on;
      if (!on) return;
      const pa = bonePos(a);
      const pb = bonePos(b);
      line.geometry.attributes.position.setXYZ(0, pa.x, pa.y, pa.z);
      line.geometry.attributes.position.setXYZ(1, pb.x, pb.y, pb.z);
      line.geometry.attributes.position.needsUpdate = true;
    };
    set("shoulderAxis", "lShoulder", "rShoulder", trailCfg.shoulderAxis);
    set("hipAxis", "lUpLeg", "rUpLeg", trailCfg.hipAxis);
  }

  /** Redraws the enabled trails ending at clip frame `frameIdx`. Call after
   * setJoints() for that same frame (playback, scrubbing, stepping). */
  function updateTrails(frameIdx) {
    const enabled = Object.keys(TRAIL_COLORS).filter((k) => trailCfg[k]);
    for (const k of Object.keys(TRAIL_COLORS)) if (!trailCfg[k]) trailLines[k].visible = false;
    if (enabled.length === 0 || clipFramesRef.length === 0 || !initialized) return;
    const end = Math.min(frameIdx, clipFramesRef.length - 1);
    const start = Math.max(0, end - Math.min(trailCfg.windowFrames, MAX_TRAIL_FRAMES));
    const pts = Object.fromEntries(enabled.map((k) => [k, []]));
    for (let f = start; f <= end; f++) {
      retargetBones(clipFramesRef[f].joints.map(worldVec3));
      for (const k of enabled) {
        const p = trailSamplers[k]();
        if (p) pts[k].push(p);
      }
    }
    setJoints(clipFramesRef[end].joints); // restore the shown pose (+ bat + axis overlays)
    for (const k of enabled) {
      const line = trailLines[k];
      const list = pts[k];
      const posAttr = line.geometry.attributes.position;
      const colAttr = line.geometry.attributes.color;
      list.forEach((p, i) => {
        posAttr.setXYZ(i, p.x, p.y, p.z);
        const fade = 0.25 + 0.75 * (list.length > 1 ? i / (list.length - 1) : 1);
        colAttr.setXYZ(i, line.userData.color.r * fade, line.userData.color.g * fade, line.userData.color.b * fade);
      });
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      line.geometry.setDrawRange(0, list.length);
      line.visible = list.length > 1;
    }
  }

  /** @param {{hands?:boolean,bat?:boolean,pelvis?:boolean,sternum?:boolean,shoulderAxis?:boolean,hipAxis?:boolean,windowFrames?:number}} cfg */
  function setTrailConfig(cfg) {
    Object.assign(trailCfg, cfg);
    trailCfg.windowFrames = Math.max(2, Math.min(MAX_TRAIL_FRAMES, Math.round(trailCfg.windowFrames)));
    if (initialized) updateAxisOverlays();
  }

  // A one-shot resize() call right after the canvas is unhidden used to be
  // enough (skeletonComparison.js still does this, as a hint), but that's a
  // real race that can lose - confirmed reproducible on a genuinely cold
  // app launch (not a warm reload within the same session): the canvas can
  // still measure 0x0 for a few frames after its container becomes visible,
  // so a single guarded call silently did nothing, permanently leaving the
  // renderer/camera sized from whatever the <canvas> width/height
  // ATTRIBUTES happened to be (360x420, aspect ~0.857) rather than the
  // element's real CSS size - the tiny, badly-cropped model this produced
  // never self-corrected until something else (a later reload, an
  // accidental camera drag) forced a fresh resize. Re-checking every tick()
  // instead of relying on one synchronous call (or even the ResizeObserver
  // below, kept as a faster-reacting supplement, not the only path) makes
  // this self-healing regardless of what caused the miss - cheap to check,
  // since the size comparison makes it a no-op once stable.
  let lastW = 0;
  let lastH = 0;
  function resize() {
    const w = canvasEl.clientWidth || canvasEl.width;
    const h = canvasEl.clientHeight || canvasEl.height;
    if (w === 0 || h === 0 || (w === lastW && h === lastH)) return;
    lastW = w;
    lastH = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvasEl);
  resize();

  function tick() {
    resize();
    controls.update();
    renderer.render(scene, camera);
  }

  function resetCamera() {
    applyDefaultCamera();
  }

  function setCameraPreset(name) {
    const azimuths = { Source: -0.52, Front: 0, Side: Math.PI / 2, Rear: Math.PI, Pitcher: 0, Batter: Math.PI };
    if (!(name in azimuths)) return;
    const target = defaultCamera.target;
    const distance = defaultCamera.distance;
    const polar = defaultCamera.polar;
    const azimuth = azimuths[name];
    controls.target.copy(target);
    const sinPolar = Math.sin(polar);
    camera.position.set(target.x + distance*sinPolar*Math.sin(azimuth), target.y + distance*Math.cos(polar), target.z + distance*sinPolar*Math.cos(azimuth));
    controls.update();
  }

  function dispose() {
    resizeObserver.disconnect();
    controls.dispose();
    // The character's geometry/materials are shared with the cached
    // template (and any other clones) via SkeletonUtils.clone() - only the
    // per-instance material we assigned above is safe/necessary to dispose;
    // the shared geometry buffers must NOT be disposed here or every other
    // open comparison view (and the next one) breaks.
    character.traverse((node) => {
      if (node.isMesh && node.material) node.material.dispose();
    });
    scene.remove(character);
    [...Object.values(trailLines), ...Object.values(axisLines)].forEach((line) => {
      line.geometry.dispose();
      line.material.dispose();
    });
    [groundMesh, batMesh, contactRing].forEach((obj) => {
      if (!obj) return;
      obj.geometry.dispose();
      obj.material.dispose();
    });
    renderer.dispose();
  }

  return { setClipFrames, setJoints, setTrailConfig, updateTrails, resetCamera, setCameraPreset, resize, tick, dispose, camera, controls };
}

/** Bidirectional camera mirroring for a two-panel comparison (real vs.
 * corrected) - dragging EITHER panel rotates both, matching the old
 * shared-camera-object behavior, since a side-by-side comparison only makes
 * sense viewed from the same angle. A `syncing` guard prevents the two
 * controls' 'change' events from feeding back into each other forever. */
export function linkScenes(sceneA, sceneB) {
  let syncing = false;
  function mirror(from, to) {
    if (syncing) return;
    syncing = true;
    to.camera.position.copy(from.camera.position);
    to.controls.target.copy(from.controls.target);
    to.controls.update();
    syncing = false;
  }
  sceneA.controls.addEventListener("change", () => mirror(sceneA, sceneB));
  sceneB.controls.addEventListener("change", () => mirror(sceneB, sceneA));
}
