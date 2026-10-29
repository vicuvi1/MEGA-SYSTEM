// Webcam + MediaPipe pose detection. Calls onFrame(landmarks | null, timeMs) for every frame.

const MP_VERSION = "0.10.14";
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];

let landmarkerPromise = null;

function loadLandmarker() {
  landmarkerPromise ??= (async () => {
    const { PoseLandmarker, FilesetResolver } = await import(`${MP_BASE}/vision_bundle.mjs`);
    const vision = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    const make = (delegate) => PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: "VIDEO",
      numPoses: 1,
    });
    try {
      return await make("GPU");
    } catch {
      return await make("CPU");
    }
  })();
  landmarkerPromise.catch(() => { landmarkerPromise = null; }); // Allow a retry after a network error.
  return landmarkerPromise;
}

export async function startPoseCamera(video, canvas, onFrame) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();

  const landmarker = await loadLandmarker();
  const ctx = canvas.getContext("2d");
  let running = true;
  let lastVideoTime = -1;

  const loop = () => {
    if (!running) return;
    if (video.currentTime !== lastVideoTime && video.videoWidth) {
      lastVideoTime = video.currentTime;
      const now = performance.now();
      const result = landmarker.detectForVideo(video, now);
      const lms = result.landmarks?.[0] ?? null;
      draw(ctx, canvas, video, lms);
      onFrame(lms, now, video.videoWidth / video.videoHeight);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  return () => {
    running = false;
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };
}

function draw(ctx, canvas, video, lms) {
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!lms) return;
  const p = (i) => [lms[i].x * canvas.width, lms[i].y * canvas.height];
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(3, canvas.width / 260);
  ctx.strokeStyle = "rgba(255, 181, 71, 0.75)";
  for (const [a, b] of BONES) {
    if ((lms[a].visibility ?? 0) < 0.4 || (lms[b].visibility ?? 0) < 0.4) continue;
    ctx.beginPath();
    ctx.moveTo(...p(a));
    ctx.lineTo(...p(b));
    ctx.stroke();
  }
  ctx.fillStyle = "#fff";
  for (const i of [11, 12, 13, 14, 15, 16, 23, 24]) {
    if ((lms[i].visibility ?? 0) < 0.4) continue;
    ctx.beginPath();
    ctx.arc(...p(i), ctx.lineWidth * 1.3, 0, Math.PI * 2);
    ctx.fill();
  }
}
