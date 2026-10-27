import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AIService } from './aiService'
import { openDb, type DB } from './db'
import { Wallet } from './wallet'

let dir: string
let db: DB
let wallet: Wallet
let aiService: AIService

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'life-ai-test-'))
  db = openDb(join(dir, 'life.db'))
  wallet = new Wallet(db, 'UTC')
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('AIService Backend', () => {
  it('saves and reads encrypted config safely', () => {
    const filePath = join(dir, 'ai_test.bin')
    const service = new AIService(filePath, wallet)

    expect(service.getConfig().geminiKey).toBe('')
    expect(service.getConfig().selectedModel).toBe('auto')

    service.saveConfig({
      geminiKey: 'AIzaSyDemo123',
      openRouterKey: 'sk-or-demo456',
      selectedModel: 'gemini-3.5-flash'
    })

    const read = service.getConfig()
    expect(read.geminiKey).toBe('AIzaSyDemo123')
    expect(read.openRouterKey).toBe('sk-or-demo456')
    expect(read.selectedModel).toBe('gemini-3.5-flash')
  })

  it('calls Gemini endpoint and parses response cleanly', async () => {
    const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      expect(String(url)).toContain('generativelanguage.googleapis.com')
      expect(String(url)).toContain('gemini-3.5-flash')
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify([
                      {
                        title: 'Noise Cancelling Headphones',
                        price: 1200,
                        realCost: 1000,
                        tier: 'silver',
                        category: 'tech',
                        note: 'Deep study tool',
                        imageUrl: 'https://images.unsplash.com/demo.jpg'
                      }
                    ])
                  }
                ]
              }
            }
          ]
        }),
        { status: 200 }
      )
    }

    const filePath = join(dir, 'ai_test.bin')
    const service = new AIService(filePath, wallet, undefined, undefined, undefined, mockFetch as any)
    service.saveConfig({ geminiKey: 'AIzaTestKey', selectedModel: 'gemini-3.5-flash' })

    const res = await service.generateRewards('headphones')
    expect(res.rewards).toHaveLength(1)
    expect(res.rewards[0].title).toBe('Noise Cancelling Headphones')
    expect(res.modelUsed).toContain('GEMINI')
  })

  it('calls OpenRouter endpoint for performance report when configured', async () => {
    const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      expect(String(url)).toContain('openrouter.ai')
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  gradeRating: 'S-Rank',
                  headline: 'Supreme Momentum',
                  summary: 'Outstanding habit velocity.',
                  strengths: ['Early wakeups'],
                  growthAreas: ['More pushups'],
                  strategicDirectives: ['Conquer next gate'],
                  warriorVerdict: 'Arise.'
                })
              }
            }
          ]
        }),
        { status: 200 }
      )
    }

    const filePath = join(dir, 'ai_test.bin')
    const service = new AIService(filePath, wallet, undefined, undefined, undefined, mockFetch as any)
    service.saveConfig({ openRouterKey: 'sk-or-test', selectedModel: 'auto' })

    const report = await service.generatePerformanceReport()
    expect(report.gradeRating).toBe('S-Rank')
    expect(report.headline).toBe('Supreme Momentum')
    expect(report.modelUsed).toContain('OPENROUTER')
  })

  it('executes askCoach with context and multi-turn history', async () => {
    const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String((init as any)?.body))
      const promptText = body.contents?.[0]?.parts?.[0]?.text
      expect(promptText).toContain('SOLO LEVELING HUNTER ORACLE')
      expect(promptText).toContain('What is my next objective?')
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: 'Hunter Victor, execute your high priority study block immediately.' }]
              }
            }
          ]
        }),
        { status: 200 }
      )
    }

    const filePath = join(dir, 'ai_test.bin')
    const service = new AIService(filePath, wallet, undefined, undefined, undefined, mockFetch as any)
    service.saveConfig({ geminiKey: 'AIzaKey', selectedModel: 'gemini-3.5-flash' })

    const reply = await service.askCoach('What is my next objective?')
    expect(reply.reply).toContain('Hunter Victor')
    expect(reply.modelUsed).toContain('GEMINI')
  })

  it('decomposes tasks into subtasks via decomposeTask', async () => {
    const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      strategyTip: 'Split research and writing.',
                      subtasks: [
                        { title: 'Read specifications', minutes: 15, coins: 5, xp: 10, priority: 2 },
                        { title: 'Write report core', minutes: 40, coins: 20, xp: 40, priority: 1 }
                      ]
                    })
                  }
                ]
              }
            }
          ]
        }),
        { status: 200 }
      )
    }

    const filePath = join(dir, 'ai_test.bin')
    const service = new AIService(filePath, wallet, undefined, undefined, undefined, mockFetch as any)
    service.saveConfig({ geminiKey: 'AIzaKey', selectedModel: 'gemini-3.5-flash' })

    const res = await service.decomposeTask('SI-266 Lab 7', 'cryptography', 'university')
    expect(res.strategyTip).toBe('Split research and writing.')
    expect(res.subtasks).toHaveLength(2)
    expect(res.subtasks[0].title).toBe('Read specifications')
  })
})
