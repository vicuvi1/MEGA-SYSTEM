import { cp, mkdir } from 'node:fs/promises'
await mkdir('out/renderer', { recursive: true })
await cp('dist', 'out/renderer', { recursive: true })
