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
  H36M_JOINT_NAMES, L_SHOULDER, R_SHOULDER, L_HIP, R_HIP, THORAX, NECK, HEAD, HEAD_TOP,
  L_WRIST, R_WRIST, L_ELBOW, R_ELBOW, L_KNEE, R_KNEE, L_ANKLE, R_ANKLE,
} from "./h36mSkeleton.js";

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
  hips: "mixamorigHips",
  spine: "mixamorigSpine", spine1: "mixamorigSpine1", spine2: "mixamorigSpine2",
  neck: "mixamorigNeck", head: "mixamorigHead", headTop: "mixamorigHeadTop_End",
  lShoulder: "mixamorigLeftShoulder", lArm: "mixamorigLeftArm", lForeArm: "mixamorigLeftForeArm", lHand: "mixamorigLeftHand",
  rShoulder: "mixamorigRightShoulder", rArm: "mixamorigRightArm", rForeArm: "mixamorigRightForeArm", rHand: "mixamorigRightHand",
  lUpLeg: "mixamorigLeftUpLeg", lLeg: "mixamorigLeftLeg", lFoot: "mixamorigLeftFoot",
  rUpLeg: "mixamorigRightUpLeg", rLeg: "mixamorigRightLeg", rFoot: "mixamorigRightFoot",
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
// Bones not listed here (spine1, spine2, lShoulder, rShoulder, lHand, rHand,
// lFoot, rFoot, headTop) are deliberately left at their REST local rotation -
// either because H36M has no corresponding joint (fingers, toes - H36M-17
// has no foot joints at all) or because the rotation is already fully
// accounted for by a parent bone (spine1/spine2 stay rigid relative to
// spine, matching H36M's own single hip->thorax segment assumption).
const AIM_RETARGET = {
  neck: { child: "head", from: NECK, to: HEAD },
  head: { child: "headTop", from: HEAD, to: HEAD_TOP },
  lArm: { child: "lForeArm", from: L_SHOULDER, to: L_ELBOW },
  lForeArm: { child: "lHand", from: L_ELBOW, to: L_WRIST },
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
  controls.minPolarAngle = Math.PI * 0.12;
  controls.maxPolarAngle = Math.PI * 0.85;
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

  /** Called once per clip, before the first setJoints() - computes the
   * per-clip "auto-level" correction. This pipeline has no real camera
   * calibration (scripts/pose3d/lift_3d.py's WORLD_ROTATION is a single
   * fixed rotation borrowed from VideoPose3D's own demo/visualizer code,
   * which its own authors label visualization-only) - for some real camera
   * angles the resulting "vertical" axis is measurably wrong. Confirmed
   * directly against a real clip's overlay video (2D tracking accurate,
   * genuinely upright stance the whole time) vs. its reconstructed
   * torso_tilt_from_vertical_deg (48-65deg for the ENTIRE clip). Estimates
   * the clip's own average torso-up direction and rotates the WHOLE clip
   * rigidly (same correction every frame, so all real relative motion is
   * fully preserved) so it reads close to upright. Display-only - does not
   * touch stored video_clip_metrics angles, see NEXT_STEPS.md. */
  function setClipFrames(frames) {
    const avgUp = new THREE.Vector3();
    for (const f of frames) {
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
  }

  function resize() {
    const w = canvasEl.clientWidth || canvasEl.width;
    const h = canvasEl.clientHeight || canvasEl.height;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvasEl);
  resize();

  function tick() {
    controls.update();
    renderer.render(scene, camera);
  }

  function resetCamera() {
    applyDefaultCamera();
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
    [groundMesh, batMesh, contactRing].forEach((obj) => {
      if (!obj) return;
      obj.geometry.dispose();
      obj.material.dispose();
    });
    renderer.dispose();
  }

  return { setClipFrames, setJoints, resetCamera, resize, tick, dispose, camera, controls };
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
