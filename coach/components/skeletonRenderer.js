// Canvas2D H36M-17 skeleton renderer - adapts the PROVEN rendering
// technique from reports/latham-lady-bison-white-10u/emily_c_swing_model.html
// (manual yaw/pitch orthographic projection, three-stroke capsule bones,
// radial-gradient joints) to a real 17-index joint array instead of that
// page's 14 hand-named joints. That page is untouched by this file - it's a
// separate, already-approved illustration; only its rendering CODE is reused.
//
// Coordinate system: video_clip_pose3d.frames[i].joints are Z-up,
// root-relative, "metric-ish" H36M units (see scripts/pose3d/lift_3d.py's
// module docstring: world-frame X/Y are the horizontal plane, Z is
// ground-to-head). The old page's project() rotated yaw in its (x,z) plane
// and treated p[1] as the untouched pre-pitch vertical axis, because ITS
// authored space was Y-up. Here the same math is reused with the roles
// swapped to match Z-up data: yaw rotates in the (x,y) horizontal plane,
// and z is the untouched pre-pitch vertical axis.
//
// scale/pitch/yaw/groundFrac are NOT a drop-in port of the old page's
// scale=230 - that was hand-tuned for its own authored figure's proportions.
// Real H36M root-relative output is a different scale entirely; DEFAULT_CAMERA
// below is the result of a real visual re-tuning pass (see
// coach/dev/skeleton-test.html) against actual rendered swing data, not an
// assumed constant.

import { BONES, ARM_BONE_KEYS, LEG_BONE_KEYS, HEAD_BONE_KEYS, TORSO_QUAD, boneKey,
  L_ANKLE, R_ANKLE, L_ELBOW, R_ELBOW, L_WRIST, R_WRIST, HEAD_TOP } from "./h36mSkeleton.js";

// Empirically derived (not guessed) against the real, full-clip bounding box
// of frames/emily_c/Emily_C_AB1 (4)'s smoothed joint data (see
// coach/dev/skeleton-test.html + the numeric bounding-box search run against
// it): yaw/pitch chosen from a sweep that minimizes the swing's on-screen
// horizontal footprint (a near-face-on yaw makes one leg swing far to one
// side during the stride/rotation, needlessly shrinking the whole figure to
// keep it on-screen), scale/groundFrac chosen so the full swing's real
// vertical bounding box (root-relative, so "ground" isn't literally at
// vert=0 the way the old authored page's HIP_Y offset made it) fits on
// canvas with margin. Re-run that same search if a very different body of
// clips ever makes this look consistently off-center.
export const DEFAULT_CAMERA = { yaw: -0.52, pitch: 0.17, scale: 500, groundFrac: 0.54 };

export const DEFAULT_COLORS = {
  torso: "#3987e5",
  arm: "#f0f2f5",
  leg: "#0ca30c",
  head: "#3987e5",
  bat: "#b08d57",
  contact: "#e0b000",
};

export function project(p, camera, w, h) {
  const c1 = Math.cos(camera.yaw), s1 = Math.sin(camera.yaw);
  const x = p[0] * c1 + p[1] * s1;
  const depth = -p[0] * s1 + p[1] * c1;
  const c2 = Math.cos(camera.pitch), s2 = Math.sin(camera.pitch);
  const vert = p[2] * c2 - depth * s2;
  return [w / 2 + x * camera.scale, h * camera.groundFrac - vert * camera.scale];
}

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = amt < 0 ? 1 + amt : 1 - amt;
  const mix = (c) => (amt < 0 ? Math.round(c * f) : Math.round(c * f + 255 * amt));
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

export function drawCapsule(ctx, p1, p2, color, width) {
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const off = width * 0.22;

  ctx.lineCap = "round";
  ctx.strokeStyle = shade(color, -0.35);
  ctx.lineWidth = width + 3;
  ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();

  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();

  ctx.strokeStyle = shade(color, 0.35);
  ctx.lineWidth = Math.max(2, width * 0.32);
  ctx.beginPath();
  ctx.moveTo(p1[0] + nx * off, p1[1] + ny * off);
  ctx.lineTo(p2[0] + nx * off, p2[1] + ny * off);
  ctx.stroke();
}

export function drawJoint(ctx, p, color, r) {
  ctx.fillStyle = shade(color, -0.35);
  ctx.beginPath(); ctx.arc(p[0], p[1], r + 1.5, 0, Math.PI * 2); ctx.fill();
  const grad = ctx.createRadialGradient(p[0] - r * 0.3, p[1] - r * 0.3, r * 0.1, p[0], p[1], r);
  grad.addColorStop(0, shade(color, 0.4));
  grad.addColorStop(1, color);
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fill();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number[][]} joints - 17 x [x,y,z], H36M order (see h36mSkeleton.js)
 * @param {number} w
 * @param {number} h
 * @param {{yaw:number,pitch:number,scale:number,groundFrac:number}} camera
 * @param {{colors?: object, drawBat?: boolean, highlightContact?: boolean, drawGround?: boolean}} [opts]
 */
export function drawFigure(ctx, joints, w, h, camera, opts = {}) {
  const colors = { ...DEFAULT_COLORS, ...(opts.colors || {}) };
  const drawBat = opts.drawBat !== false;
  const drawGround = opts.drawGround !== false;

  ctx.clearRect(0, 0, w, h);
  const proj = joints.map((p) => project(p, camera, w, h));

  if (drawGround) {
    const groundY = Math.max(proj[L_ANKLE][1], proj[R_ANKLE][1]);
    ctx.strokeStyle = "rgba(120,120,120,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(w * 0.1, groundY + 10); ctx.lineTo(w * 0.9, groundY + 10); ctx.stroke();
  }

  ctx.fillStyle = colors.torso;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.moveTo(proj[TORSO_QUAD[0]][0], proj[TORSO_QUAD[0]][1]);
  for (let i = 1; i < TORSO_QUAD.length; i++) ctx.lineTo(proj[TORSO_QUAD[i]][0], proj[TORSO_QUAD[i]][1]);
  ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 1;

  for (const [a, b] of BONES) {
    const key = boneKey(a, b);
    let width = 13, color = colors.torso;
    if (ARM_BONE_KEYS.has(key)) { width = 14; color = colors.arm; }
    else if (LEG_BONE_KEYS.has(key)) { width = 17; color = colors.leg; }
    else if (HEAD_BONE_KEYS.has(key)) { width = 11; color = colors.head; }
    drawCapsule(ctx, proj[a], proj[b], color, width);
  }

  for (let j = 0; j < joints.length; j++) {
    drawJoint(ctx, proj[j], colors.torso, 6);
  }
  drawJoint(ctx, proj[HEAD_TOP], colors.head, 15);

  if (drawBat) {
    const j = joints;
    const grip = [
      (j[L_WRIST][0] + j[R_WRIST][0]) / 2,
      (j[L_WRIST][1] + j[R_WRIST][1]) / 2,
      (j[L_WRIST][2] + j[R_WRIST][2]) / 2,
    ];
    let fx = (j[L_WRIST][0] - j[L_ELBOW][0]) + (j[R_WRIST][0] - j[R_ELBOW][0]);
    let fy = (j[L_WRIST][1] - j[L_ELBOW][1]) + (j[R_WRIST][1] - j[R_ELBOW][1]);
    let fz = (j[L_WRIST][2] - j[L_ELBOW][2]) + (j[R_WRIST][2] - j[R_ELBOW][2]);
    const flen = Math.hypot(fx, fy, fz);
    if (flen > 1e-6) {
      fx /= flen; fy /= flen; fz /= flen;
      const knob = [grip[0] - fx * 0.05, grip[1] - fy * 0.05, grip[2] - fz * 0.05];
      const mid = [grip[0] + fx * 0.3, grip[1] + fy * 0.3, grip[2] + fz * 0.3];
      const tip = [grip[0] + fx * 0.65, grip[1] + fy * 0.65, grip[2] + fz * 0.65];
      drawCapsule(ctx, project(knob, camera, w, h), project(mid, camera, w, h), colors.bat, 6);
      drawCapsule(ctx, project(mid, camera, w, h), project(tip, camera, w, h), colors.bat, 10);

      if (opts.highlightContact) {
        const bp = project(grip, camera, w, h);
        ctx.fillStyle = colors.contact;
        ctx.beginPath(); ctx.arc(bp[0], bp[1], 7, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = colors.contact; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(bp[0], bp[1], 12, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }
}
