# Exercise demo videos: where they come from

Short, silent demo loops shown in Sport Track's Workout mode. Each one is a
re-encoded copy of a file from **Wikimedia Commons**. The licences were read
from each file page's metadata on 2026-11-11. None of these files is
AI-made. The app shows a small source and licence tag on every demo and calls
none of them "verified" until the owner confirms the technique.

The typed list the app reads is `src/core/trainMedia.ts`. Files under a
share-alike licence are kept apart in `by-sa/`, with their own notice.

| File | Title (source) | Author | Licence | Changes made |
|---|---|---|---|---|
| `squat-fitnessscape.webm` | "Squat - exercise demonstration video" — https://commons.wikimedia.org/wiki/File:Squat_-_exercise_demonstration_video.webm | FitnessScape | CC BY 3.0 — https://creativecommons.org/licenses/by/3.0/ | Scaled from 720p to 540p, 24 fps, re-encoded to VP9, no audio. |
| `pullup-fitnessscape.webm` | "Pull-ups - exercise demonstration video" — https://commons.wikimedia.org/wiki/File:Pull-ups_-_exercise_demonstration_video.webm | FitnessScape | CC BY 3.0 — https://creativecommons.org/licenses/by/3.0/ | Scaled from 720p to 540p, 24 fps, re-encoded to VP9, no audio. |
| `hanging-leg-raise-fitnessscape.webm` | "Leg raises - exercise demonstration video" — https://commons.wikimedia.org/wiki/File:Leg_raises_-_exercise_demonstration_video.webm | FitnessScape | CC BY 3.0 — https://creativecommons.org/licenses/by/3.0/ | Scaled from 720p to 540p, 24 fps, re-encoded to VP9, no audio. |
| `hanging-knee-raise-fitnessscape.webm` | "Hanging crunches - exercise demonstration video" — https://commons.wikimedia.org/wiki/File:Hanging_crunches_-_exercise_demonstration_video.webm | FitnessScape | CC BY 3.0 — https://creativecommons.org/licenses/by/3.0/ | Scaled from 720p to 540p, 24 fps, re-encoded to VP9, no audio. |
| `pushup-navy.webm` | "Navy-seal-buds-training-push-ups" — https://commons.wikimedia.org/wiki/File:Navy-seal-buds-training-push-ups.ogv | United States Navy (Naval Special Warfare) | Public domain (a work of the US federal government) | Cut to 6.5 s (from 1:23), letterbox cropped, scaled to 400p, 24 fps, converted from Ogg to VP9 webm, no audio. |
| `forward-lunge-army.webm` | "Strength Training Circuit- Forward Lunge" — https://commons.wikimedia.org/wiki/File:Strength_Training_Circuit-_Forward_Lunge.webm | U.S. Army (Army Combat Fitness Test) | Public domain (a work of the US federal government) | Cut to 10 s (from 0:43), scaled to 480p, 24 fps, re-encoded to VP9, no audio. |

FitnessScape credit line, as CC BY 3.0 asks: "<title>" by FitnessScape,
CC BY 3.0, via Wikimedia Commons; re-encoded and scaled as listed above.

The US Navy and US Army files are public domain; the credit is given as a
courtesy. Their use does not mean any endorsement by the US government.

The Free Exercise DB photo frames that the app falls back to are in
`../photos/` (public domain, The Unlicense; see `../photos/NOTICE.md`).
