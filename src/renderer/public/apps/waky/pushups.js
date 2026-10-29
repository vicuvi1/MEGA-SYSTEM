// Push-up counting from pose landmarks (MediaPipe's 33-point body model).
// Pure functions, so they can be tested without a camera: see tests/pushups.test.mjs.

const SIDES = {
  left: { shoulder: 11, elbow: 13, wrist: 15, hip: 23 },
  right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24 },
};

// Angle at b, in degrees. `aspect` (width / height) undoes the stretch of normalized coordinates.
export function angle(a, b, c, aspect = 1) {
  const v1 = [(a.x - b.x) * aspect, a.y - b.y];
  const v2 = [(c.x - b.x) * aspect, c.y - b.y];
  const dot = v1[0] * v2[0] + v1[1] * v2[1];
  const len = Math.hypot(...v1) * Math.hypot(...v2);
  if (!len) return 180;
  return (Math.acos(Math.max(-1, Math.min(1, dot / len))) * 180) / Math.PI;
}

const vis = (p) => p?.visibility ?? 0;

// Decide whether the pose looks like a push-up and return the elbow angle.
// `reason` says what to fix when it doesn't.
export function analyzePose(landmarks, aspect = 16 / 9) {
  if (!landmarks?.length) return { ok: false, reason: "nobody" };

  // Use the arm the camera sees best (the one nearest to it, when side-on).
  const score = (s) => vis(landmarks[s.shoulder]) + vis(landmarks[s.elbow]) + vis(landmarks[s.wrist]);
  const side = score(SIDES.left) >= score(SIDES.right) ? SIDES.left : SIDES.right;
  const [sh, el, wr, hip] = [side.shoulder, side.elbow, side.wrist, side.hip].map((i) => landmarks[i]);

  if (Math.min(vis(sh), vis(el), vis(wr)) < 0.5) return { ok: false, reason: "arms" };
  if (vis(hip) < 0.4) return { ok: false, reason: "body" };

  // Body roughly horizontal: rules out standing up and bending your arms.
  const dx = Math.abs(hip.x - sh.x) * aspect;
  const dy = Math.abs(hip.y - sh.y);
  const tilt = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (tilt > 45) return { ok: false, reason: "horizontal" };

  // Hands on the floor, below the shoulders.
  if (wr.y < sh.y - 0.02) return { ok: false, reason: "hands" };

  return { ok: true, elbow: angle(sh, el, wr, aspect) };
}

export const HINTS = {
  nobody: "Get in front of the camera",
  arms: "Turn side-on so the camera sees your arm",
  body: "Move back so your whole body is in view",
  horizontal: "Get into push-up position",
  hands: "Hands on the floor, under your shoulders",
};

// Counts a rep each time the elbow goes from straight to bent (below `down`) and back to straight.
export class RepCounter {
  constructor({ down = 100, up = 150, minMs = 450, smoothing = 0.5 } = {}) {
    Object.assign(this, { down, up, minMs, smoothing });
    this.reps = 0;
    this.phase = "wait"; // wait -> up -> down -> up (+1)
    this.value = null;
    this.lowest = 180;
    this.lastRepAt = -Infinity;
  }

  // Feed one frame's elbow angle (or null when the pose isn't valid). Returns what happened.
  push(elbow, t) {
    if (elbow == null) return { reps: this.reps, phase: this.phase, event: null };
    this.value = this.value == null ? elbow : this.value + (elbow - this.value) * this.smoothing;
    const a = this.value;
    let event = null;

    if (this.phase === "wait") {
      if (a > this.up) this.phase = "up";
    } else if (this.phase === "up") {
      this.lowest = Math.min(this.lowest, a);
      if (a < this.down) {
        this.phase = "down";
      } else if (a > this.up && this.lowest < this.up - 20) {
        event = "shallow"; // Bent and came back up without going low enough.
        this.lowest = 180;
      }
    } else if (this.phase === "down" && a > this.up) {
      this.phase = "up";
      this.lowest = 180;
      if (t - this.lastRepAt >= this.minMs) {
        this.reps += 1;
        this.lastRepAt = t;
        event = "rep";
      }
    }
    return { reps: this.reps, phase: this.phase, event, angle: a };
  }
}
