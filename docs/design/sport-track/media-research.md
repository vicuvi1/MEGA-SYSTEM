# Exercise demo media research (Life System) - VERIFIED UPDATE (2026-11-11)

Network opened for wger.de, commons.wikimedia.org, upload.wikimedia.org. Queried with UA "LifeSystem-media-research/1.0",
~1 req/s (Commons rate-limited: 429s retried with back-off). Pexels/Pixabay/Mixkit/Everkinetic/ExerciseDB hosts still blocked, so
those rows from the first pass below stay UNVERIFIED (but Everkinetic is verified through wger: see below).
Not done: I did not watch videos (no frames fetched), so "technique" is judged from titles/uploader/series only. A human must eyeball each clip.

## wger.de (verified via API)
- Licences table: 1 CC-BY-SA 3, 2 CC-BY-SA 4, 3 CC0, 4 CC-BY 4, 5 ODbL.
- /api/v2/video/: 78 videos, 46 exercises, ALL licence 2 (CC-BY-SA 4.0), ALL author "Goulart" (license_author_url empty).
  They ARE bundled files hosted by wger (wger.de/media/exercise-video/...), not YouTube links. But: 75 are 1920x1080 (some 4K) HEVC .MOV,
  3 are MP4; total 3.57 GB, typical 20-60 MB each (Leg press 528 MB, Romanian DL 480 MB). Far too big to bundle; HEVC .MOV also does not play in Chromium without transcoding.
  Content is gym/machine/barbell work (curls, leg press, cable rows, skullcrushers, calf raises). Only two overlap our ladders:
  Dips (id 194, 3 clips, 18 MB) and Pull-ups (id 475, 1 clip, 57 MB); also Hip Thrust (barbell) and lunges (barbell/dumbbell). Not useful otherwise.
- /api/v2/exerciseimage/: 389 images, 46 flagged is_ai_generated (EXCLUDE: owner refuses AI). Remaining 343: licence mostly CC-BY-SA 4.0 (many authors) plus
  83 Everkinetic (CC-BY-SA 3.0, author "Everkinetic"), 6 CC0 ("yuhonas/free-exercise-db"). ~100 images have EMPTY author field = attribution not possible properly: skip those.
  Bodyweight-relevant stills (exercise id: name, licence, author):
  458 Plank (BY-SA4 utkb, 9 imgs); 456 Pistol Squat (BY-SA4 wakanda90, 4 jpg); 1198 Inverted Rows (BY-SA4 Gavru); 988 Bulgarian split squats (BY-SA4 Franpol);
  1551 Push-Up (BY-SA4 Settebello); 1112 Push-Ups Decline (BY-SA4 anon1337); 1000 Floor dips (BY-SA4 Franpol); 197 Dips Between Two Benches (BY-SA3 Everkinetic);
  152 Chin Up (BY-SA3 Everkinetic); 194 Dips (BY-SA4 cshep442); 475 Pull-ups (BY-SA4 Imobard); 265 Glute Bridge (BY-SA4, no author: skip);
  2678 Incline Row - Rings (no author: skip); 959 TRX Rows (BY-SA4 clafal); 999 Reverse lunges (BY-SA4 philip); 984 Lunges (Franpol); 377 Leg Raises, Lying (BY-SA3 Everkinetic);
  957 Quadriped Arm and Leg Raise (BY-SA4 utkb); 1080 Hindu Pushups; 1217 Finger Pushup (no author).
  Everkinetic is verified as the CC-BY-SA 3.0 source (line-art 2-frame images), reachable only via wger here.

## Wikimedia Commons (verified file metadata; all webm/ogv)
Bundle-safe video found:
| Move | File | Licence | Author | Format/size |
|---|---|---|---|---|
| Squat | Squat - exercise demonstration video.webm | CC BY 3.0 | FitnessScape | webm 1280x720, 564 kB |
| Pull-up | Pull-ups - exercise demonstration video.webm | CC BY 3.0 | FitnessScape | webm 1280x720, 358 kB |
| Leg raise | Leg raises - exercise demonstration video.webm | CC BY 3.0 | FitnessScape | webm 1280x720, 292 kB |
| Hanging leg raise (approx) | Hanging crunches - exercise demonstration video.webm | CC BY 3.0 | FitnessScape | webm 1280x720, 360 kB |
| Single-leg squat (box pistol/pistol progression, partial) | Basic single leg squat.webm | CC BY-SA 4.0 | RickyBennison | webm 480x640, 349 kB |
| Push-up | Navy-seal-buds-training-push-ups.ogv | Public domain (US Navy) | US Navy SEALs | ogv 720x480, 18.5 MB |
| Push-up (hand-release) | Army Combat Fitness Test- Hand-Release Push-Up (HRP) (Event 3).webm | Public domain (US Army) | ACFT | webm 1080p, 24 MB |
| Pull-up | Navy-seal-buds-training-pull-ups.ogv | Public domain | US Navy | ogv 720x480, 20 MB |
| Hanging knee raise (approx) | Army Combat Fitness Test- Leg Tuck (LTK) (Event 5).webm | Public domain | ACFT | webm 1080p, 15 MB |
| Lunge (approx split squat) | Strength Training Circuit- Forward Lunge.webm | Public domain | ACFT | webm 1080p, 6.7 MB |
| Push-up variant (T push-up) | Conditioning Drill- Eight Count T Push-Up.webm | Public domain | ACFT | webm 1080p, 7 MB |
FitnessScape series (same uploader, same framing, tiny files) is the best find: also Bench press, Incline press, Bent-over row, Deadlift, Shoulder press (not our ladders).
Also on Commons: Fenix1000 one-arm pull-up clips (BY-SA 4.0, 7-11 MB), Taco fleur kettlebell clips (BY-SA 4.0, kettlebell not bodyweight).
Searches returning NOTHING usable (no relevant file): pike push-up, handstand push-up, wall handstand, archer push-up, inverted row, bench/chair dip, glute bridge,
plank, side plank, dead bug, hollow body, L-sit, step-up (results were unrelated: hover, sit spin, etc.). Commons has no ladder-style bodyweight coverage.
Technique judgment (unviewed): FitnessScape = single-uploader demo series with consistent 720p framing, tiny; likely clear but gym-style (check pull-up grip/ROM).
Military clips: PD, correct to test standards (e.g. HRP chest-to-floor), but test-style, filmed with soldiers in uniform, 18-24 MB; fine to re-encode smaller.

## Verified coverage of our ladder moves (37 ladder levels)
- Real bundle-safe VIDEO, exact match (4): push-up, pull-up, squat, leg raise (lying).
- Video, approximate match (6): hanging leg raise (hanging crunches / leg tuck), box pistol + pistol (basic single-leg squat, partial), split squat (forward lunge), band/negative pull-up and weighted chin-up (pull-up clip only, same movement start/end).
- PHOTO only (beyond existing 28 pairs): pistol squat, Bulgarian split squat, ring/TRX row, chin-up, floor/bench dips (all wger BY-SA, share-alike).
- NOTHING (stay drawn, or existing Free Exercise DB photo where we have one): knee push-up, diamond (FEDB photo exists), archer push-up, pseudo-planche, one-arm negative/one-arm push-up, archer pull-up, pike, elevated pike, wall HS hold, wall HSPU negative, wall HSPU, backpack Bulgarian, hip thrust (load), single-leg RDL, Nordic negative, dragon negative, dragon flag, L-sit, hollow hold.
About 10 of 37 levels have some video (4 exact), another handful gain new photos, ~20 have no new media.

## Recommendation (revised)
1. Ship video only for the ~10 above, as small re-encoded webm (VP9/AV1, <=1.5 MB each, 480-720p, muted loop). FitnessScape clips already ~300-560 kB: use as-is. Re-encode military ones (trim to ~10 s).
2. Prefer CC0/PD/CC-BY (military, FitnessScape). Keep CC-BY-SA items (single-leg squat, wger stills) in a separate `media-sa/` folder with its own NOTICE, flagged share-alike. Skip wger videos (3.5 GB HEVC, gym content).
3. Never use wger images with empty author or is_ai_generated=true.
4. Everything else: keep current Free Exercise DB photos + drawn animations. No free source covers calisthenics progressions (handstand, planche, archer, L-sit, dragon flag); the owner must accept the drawn fallback for those.
5. Playback: <video muted loop playsinline preload="none"> in Electron; webm VP9 plays natively. Convert ogv to webm.

## Attribution text (CC BY 3.0 requires title, author, source, licence link, changes)
"Squat - exercise demonstration video" by FitnessScape, CC BY 3.0, via Wikimedia Commons (commons.wikimedia.org/wiki/File:Squat_-_exercise_demonstration_video.webm); re-encoded/trimmed.
Same pattern for each file. US Navy/Army files: public domain (US federal works), credit courtesy not required but listed in NOTICE. Verify each file page's licence template again at ingest.

## Risks
- Technique not visually reviewed by me; FitnessScape gym style and military test style may not match our cues (e.g. "chin over bar", strict reps).
- Commons YouTube-imported files may carry mislicensed content: all files above are original uploads or US gov, but check file history at ingest.
- CC-BY-SA share-alike on cropped/transcoded media; wger authors vary, ~100 images lack author.
- Rate limiting by Commons: fetch at <=1 req/s with a descriptive UA.
- Installer size: keep total video under ~15 MB.
- Pexels/Pixabay/Mixkit/ExerciseDB remain ruled out (first-pass snippets, unverified, see licence clauses).

---- first-pass notes (pre-network), kept for reference ----
# Exercise demo media research (Life System)

## Method and big caveat
The sandbox egress proxy returns 403 on CONNECT for wger.de, commons.wikimedia.org, pexels.com, pixabay.com,
mixkit.co, everkinetic.com and exercisedb hosts (policy denial; not bypassed). WebFetch fails with DNS ENOTFOUND for wger.de.
Only raw.githubusercontent.com answers. So: NO endpoint was queried, NO file was fetched or checked, and nothing here is
verified against primary pages. Everything below comes from web-search snippets and is marked UNVERIFIED.
To verify, the session network must allow: wger.de, commons.wikimedia.org, upload.wikimedia.org, everkinetic/github.

## Per-source findings
| Source | Licence | Bundling in OSS app | Coverage / quality | Status |
|---|---|---|---|---|
| Free Exercise DB (in use) | Unlicense (public domain) | Yes, no duties | ~800 exercises, 2-frame photos, no video. Already 28 moves. Quality mixed (hence crops). | Known |
| wger.de | Per-entry CC (README: "see individual entries"); older docs say CC-BY-SA 3.0; API items carry `license`, `license_author` | Images: yes with attribution + share-alike for the media (ShareAlike applies to the media/adaptations, not the app code, but cropped/converted frames are adaptations: must be offered under same licence). Videos: search snippets suggest mostly YouTube embeds / sparse, i.e. link only. | Few videos; image set patchy; /video/ and /exerciseimage/ not queried | UNVERIFIED |
| Wikimedia Commons | Per file: CC0, CC-BY, CC-BY-SA, PD-USGov | Yes per file (webm/ogv/gif). NASA/ISS astronaut workout clips may be PD-USGov or YouTube-imported with other licences: check each. | Seen in snippets: "Basic single leg squat.webm" (Category:Strength training), Overhead Kettlebell Squat.webm, ISS push-up/pull-up/air-squat clips. Patchy, inconsistent framing, not a ladder set. | UNVERIFIED, partial |
| Pexels | Pexels License (not CC) | Risky: no sale/distribution "on a standalone basis" (unaltered/substantially same). A bundled raw clip in an installer probably counts. Also stock fitness footage is lifestyle b-roll, often poor technique. | Some push-up/plank/squat clips, no ladders | Not recommended |
| Pixabay | Pixabay Content License (not CC0 since 2019) | Same standalone clause; bars use in AI tools | Same as Pexels | Not recommended |
| Mixkit | Mixkit Free License | Secondary sources say raw clip redistribution barred; no attribution required. Conflicting. | 78 push-up clips etc., b-roll quality | Not recommended |
| Everkinetic | CC-BY-SA (one source says 4.0; 3.0 not confirmed) | Yes with attribution + share-alike (illustrations only, 2-frame style) | ~100+ illustrations, no video; consistent style | UNVERIFIED |
| NHS / UK gov | NHS site content mostly Crown copyright; OGL not confirmed for videos; downloads may be blocked | Do not assume | NHS Strength and flexibility videos include squat, press-up; nothing for progressions | Not usable unless OGL confirmed |
| ExerciseDB / RapidAPI GIFs | Paid / API terms: licence limited to subscription, must fetch fresh each use (no local storage); provenance of GIFs unclear | No | Large | RULED OUT |

## Coverage table (best available)
No move has a verified free, bundle-safe video. Candidates to verify first:
- squat / single-leg squat progression: Commons "Basic single leg squat.webm" (licence unverified)
- push-up, pull-up, air squat: Commons ISS astronaut clips (licence and technique unverified; ARED/ISS context, not instructional)
- All other moves (knee push-up, diamond, decline, archer, pseudo-planche, one-arm, inverted row, band pull-up, pike, HSPU, shrimp/pistol, Bulgarian, glute bridge, dead bug, hollow, L-sit, dips, dragon flag, nordic): no video source found. Photo fallback: Free Exercise DB (28 already), Everkinetic illustrations/wger images for gaps (CC-BY-SA).
Counts: verified video 0; likely-possible video via Commons 1-3 of ~45 ladder moves (unverified); photo 28 existing + more possible; remainder drawn (sportDraw.ts) as today.

## Recommendation
1. Do not bundle stock-site video (Pexels/Pixabay/Mixkit) or ExerciseDB.
2. Keep Free Exercise DB photos (Unlicense) as the base. Extend photo coverage from the same DB where a good pair exists (e.g. Pike push-up, Glute bridge variants, Hanging leg raise).
3. For gaps, optionally add Everkinetic/wger CC-BY-SA images, kept in a separate folder with its own NOTICE so share-alike is scoped to those media files.
4. Video: treat as opt-in. Once network is allowed, query Commons (`filetype:video`, exercise categories) and wger /video/; accept only CC0/CC-BY/PD-USGov (avoid SA unless fine with it). Expect very few hits. Without the owner recording himself, a real ladder-wide video set does not exist under free licences.
5. Technical: webm/mp4 clips of 1-3 MB each play in Electron (Chromium) via <video muted loop>; GIFs are larger, prefer converting to webm (a derivative: fine for CC-BY, must stay SA for SA files). Use per-move files, lazy-load, cap ~3 MB each.

## Attribution / NOTICE
Extend src/renderer/public/apps/sport/photos/NOTICE.md (or a sibling media/NOTICE.md) with one row per file: title, author, source URL, licence name + URL, "modified: cropped/converted" if so. Show a short "Credits" line in the how-to sheet and in the installer's third-party licences. CC-BY: author, title, source, licence link, change indication. CC-BY-SA: also state the adaptations are under the same licence.

## Risks
- Nothing here primary-verified (network blocked); licences and per-file authors may differ from snippets.
- Commons files imported from YouTube may carry wrong or misattributed licences; check file history.
- wger data is mixed 3.0/4.0 and some images come from Wikipedia with own licences.
- Share-alike on cropped/converted frames; keep separate from MIT code.
- "Standalone" clauses on Pexels/Pixabay/Mixkit are ambiguous; Pixabay/Pexels also forbid competing-library use.
- Technique quality of stock/ISS clips is not instructional; needs a human check per clip.
