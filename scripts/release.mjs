// Publishes a new version: bumps package.json, commits, tags and pushes.
// GitHub Actions then builds the installer and the app's Update button finds it.
//
//   npm run release            -> next patch (0.5.0 -> 0.5.1)
//   npm run release -- minor   -> 0.6.0
//   npm run release -- 1.0.0   -> exactly that
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

if (git('status', '--porcelain')) throw new Error('Commit or stash your changes first')
if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') throw new Error('Release from main')

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const [major, minor, patch] = pkg.version.split('.').map(Number)
const arg = process.argv[2] ?? 'patch'
const next = /^\d+\.\d+\.\d+$/.test(arg) ? arg : arg === 'major' ? `${major + 1}.0.0` : arg === 'minor' ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`

pkg.version = next
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n')
execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts'], { stdio: 'inherit', shell: true })
git('add', 'package.json', 'package-lock.json')
git('commit', '-m', `release: v${next}`)
git('tag', `v${next}`)
git('push', 'origin', 'main')
// The tag goes up on its own push: GitHub sometimes skips the workflow for a
// tag pushed together with the commit.
git('push', 'origin', `v${next}`)
console.log(`v${next} pushed. GitHub Actions is building the installer.`)
