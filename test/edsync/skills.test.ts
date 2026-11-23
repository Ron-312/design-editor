import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { EDSYNC_VERBS } from '../../src/shared/sync'

const REPO = fileURLToPath(new URL('../../', import.meta.url))
const SKILLS = {
  'design-pull': path.join(REPO, '.claude', 'skills', 'design-pull', 'SKILL.md'),
  'design-push': path.join(REPO, '.claude', 'skills', 'design-push', 'SKILL.md'),
} as const
const EDSYNC = 'node tools/edsync.mjs'
const SHELL_PROGRAMS = /^(?:node|npx|npm|git|bash|sh|zsh|pwsh|powershell|cmd|cp|mv|rm|mkdir|cat|ls|cd|curl|wget|echo|python3?|tsx|find|sed|awk|xargs|touch|chmod)\s/
const BASH_ISMS = [/&&/, /\|\|/, /\s\|\s/, /\$\(/, /\$\{?[A-Za-z_]/, /`/, /\s(?:\d?>>?|<)\s/, /;\s*\S/, /~\//, /\\$/]
const PATH_FLAGS = ['--remote-dir', '--from', '--map']

type SkillName = keyof typeof SKILLS

function skillText(name: SkillName): string {
  return readFileSync(SKILLS[name], 'utf8')
}

/** Every command a skill would run: lines of fenced code blocks and inline code spans that start with a program. */
function commandsIn(markdown: string): string[] {
  const fenced = [...markdown.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].flatMap((match) => match[1]!.split('\n'))
  const inline = [...markdown.replace(/^```[\s\S]*?^```/gm, '').matchAll(/`([^`\n]+)`/g)].map((match) => match[1]!)
  return [...fenced, ...inline].map((line) => line.trim().replace(/^(?:\$|>|PS>)\s*/, '')).filter((line) => SHELL_PROGRAMS.test(line))
}

function edsyncVerbsIn(markdown: string): string[] {
  return commandsIn(markdown)
    .filter((command) => command.startsWith(EDSYNC))
    .map((command) => command.slice(EDSYNC.length).trim().split(/\s+/)[0]!)
    .filter((verb) => !verb.startsWith('<'))
}


function paragraphsMatching(markdown: string, pattern: RegExp): string[] {
  return markdown.split(/\n\s*\n/).filter((paragraph) => pattern.test(paragraph))
}

describe.each(Object.keys(SKILLS) as SkillName[])('the %s skill', (name) => {
  it('declares its name in the frontmatter', () => {
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(skillText(name))?.[1] ?? ''
    expect(frontmatter).toMatch(new RegExp(`^name:\\s*${name}\\s*$`, 'm'))
    expect(frontmatter).toMatch(/^description:\s*\S/m)
  })

  it('runs only git and node tools/edsync.mjs <verb>, with verbs the CLI knows', () => {
    const commands = commandsIn(skillText(name))
    expect(commands.length).toBeGreaterThan(0)
    for (const command of commands) expect(command.startsWith('git ') || command.startsWith(`${EDSYNC} `), command).toBe(true)
    for (const verb of edsyncVerbsIn(skillText(name))) expect(EDSYNC_VERBS, verb).toContain(verb)
  })

  it('uses no bash-isms, so it runs the same in PowerShell, cmd and zsh', () => {
    for (const command of commandsIn(skillText(name))) {
      for (const bashIsm of BASH_ISMS) expect(bashIsm.test(command), `${command} matches ${bashIsm}`).toBe(false)
    }
  })

  it('double-quotes every path it passes to edsync', () => {
    for (const command of commandsIn(skillText(name))) {
      for (const flag of PATH_FLAGS) {
        if (!command.includes(`${flag} `)) continue
        expect(command, command).toMatch(new RegExp(`${flag} "[^"]+"`))
      }
    }
  })

  it('reads through the Artifact tool into its default scratchpad, never with an out_dir into the project', () => {
    const text = skillText(name)
    expect(text).toContain('Artifact')
    expect(text).toMatch(/scratchpad/i)
    expect(text).toMatch(/\bpaths\b/)
    expect(text).not.toMatch(/out_dir["'`]?\s*[:=]/)
  })

  it('never calls the M7 shots verb or another remote tool', () => {
    const text = skillText(name)
    expect(edsyncVerbsIn(text)).not.toContain('shots')
    expect(text).not.toMatch(/\bDesignSync\b|\bWebFetch\b/)
    expect(text).not.toMatch(/https?:\/\/claude\.ai\//)
  })
})

describe('the design-pull skill', () => {
  it('ingests the snapshot folder, then caches blobs and support.js until none are missing', () => {
    const text = skillText('design-pull')
    const commands = commandsIn(text)
    expect(commands.some((command) => /^node tools\/edsync\.mjs ingest .*--remote-dir "[^"]+"/.test(command) && command.includes('--slug'))).toBe(true)
    expect(commands.some((command) => /^node tools\/edsync\.mjs cache .*--from "[^"]+"/.test(command))).toBe(true)
    expect(text.indexOf(`${EDSYNC} ingest`)).toBeLessThan(text.indexOf(`${EDSYNC} cache`))
    expect(paragraphsMatching(text, /missing/).some((paragraph) => /repeat|again|until|re-run/i.test(paragraph))).toBe(true)
  })
})

describe('the design-push skill', () => {
  it('runs lock, classify and commit in that order, and unlocks after the commit', () => {
    const text = skillText('design-push')
    const order = ['lock', 'classify', 'commit'].map((verb) => text.indexOf(`${EDSYNC} ${verb}`))
    for (const at of order) expect(at).toBeGreaterThanOrEqual(0)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(text.lastIndexOf(`${EDSYNC} unlock`)).toBeGreaterThan(order[2]!)
  })

  it('passes classify the re-read remote snapshot folder', () => {
    const commands = commandsIn(skillText('design-push'))
    expect(commands.some((command) => /^node tools\/edsync\.mjs classify .*--remote-dir "[^"]+"/.test(command))).toBe(true)
  })

  it('publishes once, with the root and files map classify printed', () => {
    const text = skillText('design-push')
    const publishing = paragraphsMatching(text, /publish/i)
    expect(publishing.some((paragraph) => /\b(once|one|single)\b/i.test(paragraph) && /\bfiles\b/.test(paragraph) && /\broot\b/.test(paragraph))).toBe(
      true,
    )
  })

  it('never pushes to Test Site or any real canvas, only to a throwaway copy in tests', () => {
    const text = skillText('design-push')
    expect(paragraphsMatching(text, /Test Site/).some((paragraph) => /\bnever\b/i.test(paragraph))).toBe(true)
  })

  it('on a publish refusal deletes the lock, reports it and leaves the re-run to the user', () => {
    const refusal = paragraphsMatching(skillText('design-push'), /refus/i)
    expect(refusal.some((paragraph) => paragraph.includes(`${EDSYNC} unlock`) && /re-run/i.test(paragraph) && /report|tell/i.test(paragraph))).toBe(
      true,
    )
    expect(refusal.some((paragraph) => /\bretry\b/i.test(paragraph) && !/\b(not|never|no)\b[^.]*\bretry\b/i.test(paragraph))).toBe(false)
  })
})
