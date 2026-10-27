// Solo Leveling Hunter Awakening & Progression Engine
export const MAX_LEVEL = 150

export function xpToNext(level: number): number {
  return Math.round(80 * Math.pow(level, 1.3))
}

export interface HunterRankDef {
  minLevel: number
  name: string
  title: string
  grade: string
  badge: string
  color: string
  auraGlow: string
  desc: string
  perk: string
  dailyQuestBonus: number
}

export interface HunterAttributes {
  str: number // Strength (Workouts & Physical Power)
  agi: number // Agility (Circadian Wakeups & Speed)
  vit: number // Vitality (Sleep & Recovery)
  int: number // Intelligence (Focus Blocks & Study)
  sen: number // Perception / Willpower (Discipline Purity & Urge Defense)
  totalCombatPower: number
}

export interface LevelInfo {
  level: number
  xpIntoLevel: number
  xpForNext: number
  progress: number // 0..1
  rank: string
  hunterTitle: string
  hunterGrade: string
  rankBadge: string
  rankColor: string
  rankAura: string
  rankDesc: string
  rankPerk: string
  attributes: HunterAttributes
  nextRank: HunterRankDef | null
  allRanks: HunterRankDef[]
}

export const RANKS: HunterRankDef[] = [
  {
    minLevel: 1,
    name: 'Recruit (E-Rank)',
    title: 'The Weakest Hunter',
    grade: 'E-Rank',
    badge: '⚔️',
    color: '#8A93A6',
    auraGlow: 'rgba(138, 147, 166, 0.4)',
    desc: 'You have awakened at the bottom of the world. Even if called the weakest, the System has chosen you. Take your daily quest and begin your ascent.',
    perk: 'Awakening Spark: +10% XP on first daily ritual',
    dailyQuestBonus: 5
  },
  {
    minLevel: 3,
    name: 'E-Rank Scout',
    title: 'Dungeon Scout',
    grade: 'E-Rank',
    badge: '🗡️',
    color: '#A0AEC0',
    auraGlow: 'rgba(160, 174, 192, 0.4)',
    desc: 'Learning the terrain of your mind. You spot old addictive triggers and complacency before they strike.',
    perk: 'Pattern Sense: +5% Urge Resistance',
    dailyQuestBonus: 5
  },
  {
    minLevel: 5,
    name: 'D-Rank Survivor',
    title: 'Dungeon Survivor',
    grade: 'D-Rank',
    badge: '🛡️',
    color: '#4ADE80',
    auraGlow: 'rgba(74, 222, 128, 0.4)',
    desc: 'You no longer panic when habits get hard. Workouts and clean days are becoming your new normal.',
    perk: 'Iron Will: Workout fatigue reduced by 10%',
    dailyQuestBonus: 8
  },
  {
    minLevel: 8,
    name: 'D-Rank Gate Clearer',
    title: 'Gate Breaker',
    grade: 'D-Rank',
    badge: '⚡',
    color: '#52E38B',
    auraGlow: 'rgba(82, 227, 139, 0.4)',
    desc: 'Entering basic habit dungeons with certainty. Morning wake-ups and focused blocks are completed with steady rhythm.',
    perk: 'Momentum Pulse: +5 coins on completed focus blocks',
    dailyQuestBonus: 8
  },
  {
    minLevel: 10,
    name: 'C-Rank Striker',
    title: 'Dungeon Striker',
    grade: 'C-Rank',
    badge: '🏹',
    color: '#38BDF8',
    auraGlow: 'rgba(56, 189, 248, 0.45)',
    desc: 'You possess real destructive power against procrastination. The gap between your intentions and execution has shrunk dramatically.',
    perk: 'Striking Velocity: Tasks completed before noon pay +20% XP',
    dailyQuestBonus: 10
  },
  {
    minLevel: 14,
    name: 'C-Rank Raid Vanguard',
    title: 'Raid Vanguard',
    grade: 'C-Rank',
    badge: '🔱',
    color: '#0EA5E9',
    auraGlow: 'rgba(14, 165, 233, 0.45)',
    desc: 'First through the gate. When adversity strikes your schedule, you spearhead the solution instead of retreating.',
    perk: 'Frontline Fortitude: Streak Shield durability increased',
    dailyQuestBonus: 12
  },
  {
    minLevel: 18,
    name: 'B-Rank Raider',
    title: 'Dungeon Raider',
    grade: 'B-Rank',
    badge: '🔮',
    color: '#818CF8',
    auraGlow: 'rgba(129, 140, 248, 0.45)',
    desc: 'A respected warrior. Common temptations, binge spending, and impulse distractions no longer defeat you in standard encounters.',
    perk: 'Budget Fortification: Daily budget remaining bonus +10%',
    dailyQuestBonus: 15
  },
  {
    minLevel: 22,
    name: 'B-Rank High Striker',
    title: 'High Striker',
    grade: 'B-Rank',
    badge: '💥',
    color: '#6366F1',
    auraGlow: 'rgba(99, 102, 241, 0.5)',
    desc: 'High workout volume and intense focus sessions feel second nature. Your daily output outclasses 95% of your peers.',
    perk: 'Dual Strike: Double XP on days with 2+ completed study blocks',
    dailyQuestBonus: 15
  },
  {
    minLevel: 26,
    name: 'B-Rank Raid Commander',
    title: 'Tactical Commander',
    grade: 'B-Rank',
    badge: '🦅',
    color: '#A855F7',
    auraGlow: 'rgba(168, 85, 247, 0.5)',
    desc: 'Orchestrating every hour with tactical clarity. No time is wasted in mindless scrolling or hesitation.',
    perk: 'Commander Domain: All 5 daily rituals completed grants +15 bonus coins',
    dailyQuestBonus: 18
  },
  {
    minLevel: 30,
    name: 'A-Rank Elite Vanguard',
    title: 'Red Gate Conqueror',
    grade: 'A-Rank',
    badge: '🔥',
    color: '#C084FC',
    auraGlow: 'rgba(192, 132, 252, 0.5)',
    desc: 'You enter red gates without fear. Extreme workloads and intense physical challenges are systematically conquered.',
    perk: 'Red Gate Resilience: Missed block penalty reduced by 50%',
    dailyQuestBonus: 20
  },
  {
    minLevel: 35,
    name: 'A-Rank Shadow Assassin',
    title: 'Stealth Infiltrator',
    grade: 'A-Rank',
    badge: '🥷',
    color: '#E879F9',
    auraGlow: 'rgba(232, 121, 249, 0.5)',
    desc: 'Moving silently through your goals. Stealth discipline mode: results speak so loudly that explanations are unnecessary.',
    perk: 'Silent Mastery: Stealth check-ins yield +10 XP',
    dailyQuestBonus: 22
  },
  {
    minLevel: 40,
    name: 'A-Rank Master of Iron',
    title: 'Ironclad Titan',
    grade: 'A-Rank',
    badge: '🦾',
    color: '#F43F5E',
    auraGlow: 'rgba(244, 63, 94, 0.55)',
    desc: 'The physical temple is hardened. Heavy weights, push-up sets, and cold discipline have sculpted an unbreakable warrior body.',
    perk: 'Muscle Memory: Workouts logged award +5 extra coins',
    dailyQuestBonus: 25
  },
  {
    minLevel: 45,
    name: 'A-Rank Apex Hunter',
    title: 'Guild Champion',
    grade: 'A-Rank',
    badge: '👑',
    color: '#FB7185',
    auraGlow: 'rgba(251, 113, 133, 0.55)',
    desc: 'Standing at the peak of standard humanity. Every project and financial challenge is conquered before the deadline.',
    perk: 'Apex Will: Task streaks award +25 bonus coins',
    dailyQuestBonus: 28
  },
  {
    minLevel: 50,
    name: 'S-Rank Calamity Buster',
    title: 'National Awakening',
    grade: 'S-Rank',
    badge: '⭐',
    color: '#F5C84B',
    auraGlow: 'rgba(245, 200, 75, 0.6)',
    desc: 'THE MAGIC MEASURING DEVICE SHATTERS. You have entered the realm of S-Rank Hunters. Your discipline bends reality to your favor.',
    perk: 'S-Rank Authority: +25% permanent multiplier across all coin earnings',
    dailyQuestBonus: 35
  },
  {
    minLevel: 55,
    name: 'S-Rank Demon Castle Pioneer',
    title: 'Demon Slayer',
    grade: 'S-Rank',
    badge: '👹',
    color: '#EAB308',
    auraGlow: 'rgba(234, 179, 8, 0.6)',
    desc: 'Ascending the 100 floors of the Demon Castle. The demons of past addiction, regret, and low self-worth are permanently slain.',
    perk: 'Demon Slayer Will: Urge crusher completions award double coins',
    dailyQuestBonus: 38
  },
  {
    minLevel: 60,
    name: 'S-Rank Sovereign Striker',
    title: 'Apex Sovereign',
    grade: 'S-Rank',
    badge: '☄️',
    color: '#FACC15',
    auraGlow: 'rgba(250, 204, 21, 0.65)',
    desc: 'Speed, power, precision. Circadian wake-ups are clockwork; spending is surgically controlled; fitness is non-negotiable.',
    perk: 'Apex Focus: On-time wakeups award +15 coins',
    dailyQuestBonus: 40
  },
  {
    minLevel: 65,
    name: 'National Level Hunter',
    title: 'World Authority',
    grade: 'National Level',
    badge: '🌍',
    color: '#00D2FF',
    auraGlow: 'rgba(0, 210, 255, 0.7)',
    desc: 'Possessing power rivaling entire nations. You control your fate with absolute sovereignty. A beacon of relentless self-discipline.',
    perk: 'National Authority: Level mystery chests guarantee rare loot drops',
    dailyQuestBonus: 50
  },
  {
    minLevel: 70,
    name: 'National Level Titan',
    title: 'Living Monolith',
    grade: 'National Level',
    badge: '🏛️',
    color: '#38BDF8',
    auraGlow: 'rgba(56, 189, 248, 0.7)',
    desc: 'Unshakable by peer pressure, immune to dopamine traps. You stand as an indestructible monolith of habit execution.',
    perk: 'Titan Shield: 1 free Streak Shield awarded upon reaching this rank',
    dailyQuestBonus: 55
  },
  {
    minLevel: 75,
    name: 'Ruler’s Vessel',
    title: 'Vessel of the Brilliant Light',
    grade: 'National Level',
    badge: '☀️',
    color: '#67E8F9',
    auraGlow: 'rgba(103, 232, 249, 0.75)',
    desc: 'Channeling divine power. Telekinetic mastery over your focus: distractions bounce off your attention span like dust.',
    perk: 'Ruler’s Reach: Focus timers flow effortlessly with zero mental friction',
    dailyQuestBonus: 60
  },
  {
    minLevel: 80,
    name: 'Monarch Candidate',
    title: 'Shadow Heir',
    grade: 'Monarch Candidate',
    badge: '🌑',
    color: '#7C3AED',
    auraGlow: 'rgba(124, 58, 237, 0.8)',
    desc: 'The System chooses you. You stand between the world of light and sovereign darkness. Your past failures become soldiers in your shadow army.',
    perk: 'Arise Extraction: Every past slip converted into permanent wisdom and XP',
    dailyQuestBonus: 70
  },
  {
    minLevel: 85,
    name: 'Commander of Shadows',
    title: 'Lord of the Undead',
    grade: 'Monarch Candidate',
    badge: '💀',
    color: '#6D28D9',
    auraGlow: 'rgba(109, 40, 217, 0.8)',
    desc: 'Summoning Igris, Tank, and Iron. Your daily routines march forward automatically without conscious willpower strain.',
    perk: 'Shadow Army: Recurring habits execute with zero friction',
    dailyQuestBonus: 75
  },
  {
    minLevel: 90,
    name: 'Sovereign of the Abyss',
    title: 'Void Sovereign',
    grade: 'Monarch',
    badge: '🌌',
    color: '#5B21B6',
    auraGlow: 'rgba(91, 33, 182, 0.85)',
    desc: 'Master of the infinite expanse. Time bends to your priorities. When you decide a goal is done, the universe aligns.',
    perk: 'Void Mastery: Reward Vault surplus earns 5% monthly dividend',
    dailyQuestBonus: 80
  },
  {
    minLevel: 95,
    name: 'Shadow Monarch',
    title: 'Monarch of Shadows (True Form)',
    grade: 'Monarch',
    badge: '👑',
    color: '#9D4EDD',
    auraGlow: 'rgba(157, 78, 221, 0.9)',
    desc: '"ARISE." The true Shadow Monarch awakens. Death of bad habits is permanent; resurrection of your highest potential is absolute.',
    perk: 'True Monarch Domain: 2x permanent coin multiplier on all discipline rituals',
    dailyQuestBonus: 100
  },
  {
    minLevel: 100,
    name: 'Sovereign of Eternal Rebirth',
    title: 'Centennial Monarch',
    grade: 'Monarch',
    badge: '♾️',
    color: '#C77DFF',
    auraGlow: 'rgba(199, 125, 255, 0.9)',
    desc: 'Centennial titan. One hundred levels of relentless sweat, restraint, and calculated focus. You rule your mind with iron certainty.',
    perk: 'Centennial Aura: Level 100 Legendary Chest unlocked with guaranteed mega drop',
    dailyQuestBonus: 110
  },
  {
    minLevel: 110,
    name: 'Transcendent Sovereign',
    title: 'Master of Dimensions',
    grade: 'Transcendent',
    badge: '🌀',
    color: '#E0AAFF',
    auraGlow: 'rgba(224, 170, 255, 0.95)',
    desc: 'You operate across dimensions of financial wealth, physical elite status, and spiritual alignment. A master of total life architecture.',
    perk: 'Dimensional Vault: Real-money reward budget cap removed',
    dailyQuestBonus: 125
  },
  {
    minLevel: 120,
    name: 'Monarch of Total Sovereignty',
    title: 'Unbreakable Ruler',
    grade: 'Transcendent',
    badge: '🩸',
    color: '#FF3366',
    auraGlow: 'rgba(255, 51, 102, 0.95)',
    desc: 'The entire system recognizes your supremacy. No urge can breach your armor; no financial turbulence can shake your foundation.',
    perk: 'Supreme Will: Complete urge immunity protocol',
    dailyQuestBonus: 140
  },
  {
    minLevel: 130,
    name: 'Absolute Being Avatar',
    title: 'Divine Creator',
    grade: 'Divine Sovereign',
    badge: '✨',
    color: '#C8F135',
    auraGlow: 'rgba(200, 241, 53, 0.95)',
    desc: 'Possessing the spark of the creator. Every daily action creates ripples of excellence across your university, fitness, and family life.',
    perk: 'Divine Spark: Triple XP on all master goals',
    dailyQuestBonus: 160
  },
  {
    minLevel: 140,
    name: 'Primordial Architect',
    title: 'Forge of Destiny',
    grade: 'Divine Sovereign',
    badge: '⚜️',
    color: '#FFD700',
    auraGlow: 'rgba(255, 215, 0, 1.0)',
    desc: 'You do not adapt to the world; the world adapts to your discipline. A mastercraft of relentless execution.',
    perk: 'Destiny Forge: Max daily coin cap increased to 500 coins',
    dailyQuestBonus: 180
  },
  {
    minLevel: 145,
    name: 'Eternal Monarch of the Cosmos',
    title: 'Cosmic Ruler',
    grade: 'Divine Sovereign',
    badge: '🌠',
    color: '#00FFFF',
    auraGlow: 'rgba(0, 255, 255, 1.0)',
    desc: 'A legendary myth made flesh. The weakest E-Rank has conquered the cosmos of his own mind and soul.',
    perk: 'Cosmic Dominion: Permanent 3x multiplier on all study and body blocks',
    dailyQuestBonus: 200
  },
  {
    minLevel: 150,
    name: 'The Apex Sovereign (Unrivaled)',
    title: 'Omnipotent Ruler of Fate',
    grade: 'Absolute Supreme',
    badge: '🏆',
    color: '#FF0055',
    auraGlow: 'rgba(255, 0, 85, 1.0)',
    desc: 'MAX LEVEL 150. The summit of human potential. You have completed the System\'s grand purpose: becoming the supreme ruler of your own destiny.',
    perk: 'Omnipotent Sovereign: Master of all domains, permanently crowned in eternal glory.',
    dailyQuestBonus: 250
  }
]

export function hunterDefFor(level: number): HunterRankDef {
  let def = RANKS[0]
  for (const r of RANKS) {
    if (level >= r.minLevel) def = r
  }
  return def
}

export function nextHunterRank(level: number): HunterRankDef | null {
  for (const r of RANKS) {
    if (r.minLevel > level) return r
  }
  return null
}

export function rankFor(level: number): string {
  return hunterDefFor(level).name
}

export function calculateHunterAttributes(
  level: number,
  params?: {
    workoutCount?: number
    cleanStreakDays?: number
    focusBlocksCount?: number
    onTimeWakeups?: number
    budgetDays?: number
  }
): HunterAttributes {
  const base = Math.max(10, Math.floor(level * 2.5))
  const strBonus = Math.floor((params?.workoutCount ?? 0) * 1.5)
  const senBonus = Math.floor((params?.cleanStreakDays ?? 0) * 2.0)
  const intBonus = Math.floor((params?.focusBlocksCount ?? 0) * 1.8)
  const agiBonus = Math.floor((params?.onTimeWakeups ?? 0) * 1.2)
  const vitBonus = Math.floor((params?.budgetDays ?? 0) * 1.0)

  const str = base + strBonus
  const sen = base + senBonus
  const int = base + intBonus
  const agi = base + agiBonus
  const vit = base + vitBonus
  const totalCombatPower = str * 3 + agi * 2 + vit * 2 + int * 3 + sen * 4

  return {
    str,
    agi,
    vit,
    int,
    sen,
    totalCombatPower
  }
}

export function levelInfo(
  totalXp: number,
  hunterStatsInput?: {
    workoutCount?: number
    cleanStreakDays?: number
    focusBlocksCount?: number
    onTimeWakeups?: number
    budgetDays?: number
  }
): LevelInfo {
  let level = 1
  let left = Math.max(0, Math.floor(totalXp))
  while (level < MAX_LEVEL && left >= xpToNext(level)) {
    left -= xpToNext(level)
    level++
  }
  const xpForNext = level >= MAX_LEVEL ? 0 : xpToNext(level)
  const def = hunterDefFor(level)
  const next = nextHunterRank(level)
  const attributes = calculateHunterAttributes(level, hunterStatsInput)

  return {
    level,
    xpIntoLevel: left,
    xpForNext,
    progress: xpForNext ? left / xpForNext : 1,
    rank: def.name,
    hunterTitle: def.title,
    hunterGrade: def.grade,
    rankBadge: def.badge,
    rankColor: def.color,
    rankAura: def.auraGlow,
    rankDesc: def.desc,
    rankPerk: def.perk,
    attributes,
    nextRank: next,
    allRanks: RANKS
  }
}
