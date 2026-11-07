# Exercise photos: where they come from

The `*.webp` frames in this folder (two per exercise: the start and the end of
the move) are cropped and resized copies of photos from the
**Free Exercise DB**: https://github.com/yuhonas/free-exercise-db
(itself built on https://github.com/wrkout/exercises.json).

Both projects release their data and images into the public domain under
**The Unlicense**. The license text, as published in those repositories
(`LICENSE.md`, checked on 2026-11-07):

```
This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <https://unlicense.org>
```

Which photo each move uses, and its crop, is in `src/core/sportPhotos.ts`;
`scripts/sport-photos.mjs` remakes the frames. Moves without a matching
photo are drawn by the app instead. Thank you to the people who made and
shared these photos.
