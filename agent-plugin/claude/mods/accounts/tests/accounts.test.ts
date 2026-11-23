// Artifact links tagged with the account that published them, and /auth
// switching the machine's account through cswap without losing a login.
import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { aliasOf, entries, tag, UNSET } from '../hooks/register'

/** /auth as typed at the prompt. */
const typed = (args: string) =>
  ({ command: 'auth', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as const

const HOME = '/home/me'
const UT_ORG = 'aaaaaaaa-0000-4000-8000-000000000001'
const TABLE = JSON.stringify({
  accounts: [
    { alias: 'ut', email: 'UT@example.com', org: UT_ORG },
    { alias: 'gt', email: 'gt@example.com' },
    { alias: 'jian', email: 'jian@example.com' },
    { alias: 'sr' },
  ],
})

/** A slot cswap keeps; creds names the login it holds ('dead' for one past its refresh). */
type Saved = { number: number; email: string; organizationUuid?: string; alias?: string; usageStatus?: string; creds?: string }
const login = (email: string, org?: string) => JSON.stringify({ oauthAccount: { emailAddress: email, organizationUuid: org } })

/** A machine: its files, its login and a session's own, what cswap has saved,
 *  and what the mod ran and logged. */
class Machine {
  files: Record<string, string> = { [`${HOME}/.config/claude-accounts/accounts.json`]: TABLE }
  saved: Saved[] = []
  /** cswap commands run, without the env prefix */
  runs: string[][] = []
  /** whole argument lists, as started */
  started: string[][] = []
  logs: string[] = []
  /** the session's CLAUDE_CONFIG_DIR, as `cswap run` sets it */
  configDir: string | undefined = undefined
  /** where cswap is: on PATH, only in ~/.local/bin, or nowhere */
  cswapAt: 'path' | 'local' | 'none' = 'path'
  /** the login token the machine holds: one name per sign-in */
  liveCreds = 'login-0'
  private signIns = 0

  constructor(email: string | null, org?: string) {
    if (email) this.files[`${HOME}/.claude.json`] = login(email, org)
  }

  /** `claude auth login`: a new login replaces the machine's, and nothing keeps the old one. */
  signIn(email: string, org?: string) {
    this.files[`${HOME}/.claude.json`] = login(email, org)
    this.liveCreds = `login-${++this.signIns}`
  }

  /** Starts this session with a login of its own, as `cswap run` does. */
  ownLogin(email: string, org?: string) {
    this.configDir = `${HOME}/.claude-swap-backup/sessions/x`
    this.files[`${this.configDir}/.claude.json`] = login(email, org)
  }

  /** The machine's login. */
  live(): { email: string; org?: string } | null {
    const raw = this.files[`${HOME}/.claude.json`]
    const a = raw ? JSON.parse(raw).oauthAccount : null
    return a ? { email: a.emailAddress, org: a.organizationUuid } : null
  }

  cswap(args: readonly string[]) {
    const done = (exitCode: number, stdout: string, stderr = '') => ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })
    const ok = (stdout = '') => done(0, stdout)
    const live = this.live()
    const isLive = (s: Saved) => !!live && s.email.toLowerCase() === live.email.toLowerCase() && (s.organizationUuid ?? null) === (live.org ?? null)
    if (args[0] === 'list') {
      // As cswap does: the live account's state comes from the machine's own login, the others' from their slots.
      const accounts = this.saved.map(s => {
        const shown: Saved = { ...s }
        delete shown.creds
        return isLive(s) ? { ...shown, active: true, usageStatus: this.liveCreds === 'dead' ? 'relogin_required' : 'ok' } : shown
      })
      return ok(JSON.stringify({ schemaVersion: 1, accounts }))
    }
    if (args[0] === 'add') {
      // As cswap does: an account it has gets its slot updated in place; a new one gets a slot.
      if (!live) return done(1, '', 'no live login')
      const slot = this.saved.find(isLive)
      if (slot) {
        slot.creds = this.liveCreds
        delete slot.usageStatus
        return ok(`Updated credentials for Account ${slot.number}`)
      }
      const number = Math.max(0, ...this.saved.map(s => s.number)) + 1
      this.saved.push({ number, email: live.email, organizationUuid: live.org, creds: this.liveCreds })
      return ok('added')
    }
    if (args[0] === 'switch') {
      const s = this.saved.find(x => String(x.number) === args[1])
      if (!s) return done(1, '', 'no such account')
      // As cswap does: the login it leaves goes into that account's slot first, when it has one.
      const leaving = this.saved.find(isLive)
      if (leaving) {
        leaving.creds = this.liveCreds
        delete leaving.usageStatus
      }
      this.files[`${HOME}/.claude.json`] = login(s.email, s.organizationUuid)
      this.liveCreds = s.creds ?? `slot-${s.number}`
      return ok(`switched to ${s.email}`)
    }
    return done(2, '', 'unknown')
  }

  /** The engine beneath the mod, for this machine. */
  engine(on: On, artifactUrl = 'https://claude.ai/artifact/AbC123') {
    on('env.get', (_, e) => ({ value: e.name === 'HOME' ? HOME : e.name === 'CLAUDE_CONFIG_DIR' ? this.configDir : undefined }))
    on('fs.read', (_, e) => {
      const text = this.files[e.path]
      return text !== undefined ? { value: text } : { deny: `${e.path}: no such file` }
    })
    on('process.run', (_, e) => {
      const argv = [...e.argv]
      this.started.push(argv)
      // Like env: the program after the unset variables, or 127 when it isn't there.
      const [bin, ...args] = argv.slice(UNSET.length)
      const found = (bin === 'cswap' && this.cswapAt === 'path') || (bin === `${HOME}/.local/bin/cswap` && this.cswapAt === 'local')
      if (argv[0] !== 'env' || !found) {
        return { value: { exitCode: 127, stdout: '', stderr: `env: ${bin}: No such file or directory`, isStdoutTruncated: false, isStderrTruncated: false } }
      }
      this.runs.push(args)
      return { value: this.cswap(args) }
    })
    on('ui.log', (_, e) => {
      this.logs.push(e.text)
      return { value: undefined }
    })
    on('tool.call', { tool: 'Artifact' }, () => ({ result: { url: artifactUrl, version: '1' } }) as never)
  }
}

const changes = (m: Machine) => m.runs.filter(r => r[0] !== 'list')
const contextOf = (r: unknown) => (r as { context?: string[] }).context ?? []

test('tag puts the alias in the fragment and keeps the rest', () => {
  expect(tag('https://claude.ai/artifact/x', 'gt')).toBe('https://claude.ai/artifact/x#acct=gt')
  expect(tag('https://claude.ai/artifact/x#top', 'gt')).toBe('https://claude.ai/artifact/x#top&acct=gt')
  expect(tag('https://claude.ai/artifact/x#acct=ut', 'gt')).toBe('https://claude.ai/artifact/x#acct=gt')
})

test('the table is read leniently and matched by email, then organization', () => {
  const table = entries(JSON.parse(TABLE))
  expect(table.map(a => a.alias)).toEqual(['ut', 'gt', 'jian', 'sr'])
  expect(entries({ accounts: [{ alias: 'bad alias' }, { email: 'x@y' }] })).toEqual([])
  expect(aliasOf(table, { email: 'ut@example.com', org: UT_ORG })).toBe('ut')
  expect(aliasOf(table, { email: 'ut@example.com', org: 'another-org' })).toBe(null)
  expect(aliasOf(table, { email: 'gt@example.com', org: 'any' })).toBe('gt')
  expect(aliasOf(table, { email: 'nobody@example.com', org: null })).toBe(null)
})

test('a published artifact gets its account tag, for the model and the person', async ($, on) => {
  const m = new Machine('gt@example.com')
  m.engine(on)
  const r = await $.tool.call({ tool: 'Artifact', file_path: '/tmp/page.html' } as never)
  expect(contextOf(r).some(c => c.includes('https://claude.ai/artifact/AbC123#acct=gt'))).toBe(true)
  expect(m.logs).toEqual(['Artifact link for gt: https://claude.ai/artifact/AbC123#acct=gt'])
})

test("a cswap run session's artifacts get its own account's tag", async ($, on) => {
  const m = new Machine('gt@example.com')
  m.ownLogin('ut@example.com', UT_ORG)
  m.engine(on)
  const r = await $.tool.call({ tool: 'Artifact', file_path: '/tmp/page.html' } as never)
  expect(contextOf(r).some(c => c.includes('#acct=ut'))).toBe(true)
})

test('an account missing from the table leaves links untagged and says so once', async ($, on) => {
  const m = new Machine('stranger@example.com')
  m.engine(on)
  const first = await $.tool.call({ tool: 'Artifact', file_path: '/tmp/a.html' } as never)
  await $.tool.call({ tool: 'Artifact', file_path: '/tmp/b.html' } as never)
  expect(contextOf(first)).toEqual([])
  expect(m.logs.length).toBe(1)
  expect(m.logs[0]).toContain("stranger@example.com isn't in")
})

test('reading or listing artifacts adds nothing', async ($, on) => {
  const m = new Machine('gt@example.com')
  m.engine(on)
  const r = await $.tool.call({ tool: 'Artifact', action: 'read', url: 'https://claude.ai/artifact/AbC123' } as never)
  expect(contextOf(r)).toEqual([])
  expect(m.logs).toEqual([])
})

test('/auth alone lists the accounts and their state', async ($, on) => {
  const m = new Machine('jian@example.com')
  m.saved = [
    { number: 1, email: 'ut@example.com', organizationUuid: UT_ORG, usageStatus: 'relogin_required' },
    { number: 2, email: 'gt@example.com' },
  ]
  m.engine(on)
  const { text } = await $.command.run(typed(''))
  expect(text).toContain('(now jian)')
  expect(text).toMatch(/ut\s+ut@example\.com\s+login expired/)
  expect(text).toMatch(/gt\s+gt@example\.com\s+ready/)
  expect(text).toMatch(/jian\s+jian@example\.com\s+current, not saved in cswap yet/)
  expect(text).toMatch(/sr\s+no email in the account table/)
  expect(text).toContain('run ~/.claude/mods/accounts/signin in a terminal')
  expect(m.runs).toEqual([['list', '--json']])
})

test('/auth saves an unsaved login before switching away from it', async ($, on) => {
  const m = new Machine('jian@example.com')
  m.saved = [{ number: 1, email: 'gt@example.com' }]
  m.engine(on)
  const { text } = await $.command.run(typed('gt'))
  expect(text).toContain('Saved the current login (jian)')
  expect(text).toContain('Switched this machine to gt')
  expect(changes(m)).toEqual([['add'], ['switch', '1']])
  expect(m.live()?.email).toBe('gt@example.com')
  expect(m.saved.some(s => s.email === 'jian@example.com')).toBe(true)
})

test('/auth runs cswap with the session variables unset', async ($, on) => {
  const m = new Machine('gt@example.com')
  m.saved = [{ number: 1, email: 'gt@example.com' }]
  m.engine(on)
  await $.command.run(typed(''))
  expect(m.started[0]).toEqual(['env', '-u', 'CLAUDE_CONFIG_DIR', '-u', 'CLAUDE_SECURESTORAGE_CONFIG_DIR', 'cswap', 'list', '--json'])
})

test('/auth from a cswap run session switches the machine and says the session stays', async ($, on) => {
  const m = new Machine('gt@example.com')
  m.ownLogin('ut@example.com', UT_ORG)
  m.saved = [
    { number: 1, email: 'gt@example.com' },
    { number: 2, email: 'ut@example.com', organizationUuid: UT_ORG },
    { number: 3, email: 'jian@example.com' },
  ]
  m.engine(on)
  const listed = (await $.command.run(typed(''))).text
  expect(listed).toContain('(now gt)')
  expect(listed).toContain('so it stays on ut')
  expect(listed).not.toContain('signin')
  const { text } = await $.command.run(typed('jian'))
  expect(text).toContain('Switched this machine to jian')
  expect(text).toContain('so it stays on ut')
  expect(changes(m)).toEqual([['switch', '3']])
  expect(m.live()?.email).toBe('jian@example.com')
})

test('/auth finds cswap in ~/.local/bin, and says how to install it when it is nowhere', async ($, on) => {
  const m = new Machine('gt@example.com')
  m.saved = [{ number: 1, email: 'gt@example.com' }, { number: 2, email: 'jian@example.com' }]
  m.cswapAt = 'local'
  m.engine(on)
  expect((await $.command.run(typed('jian'))).text).toContain('Switched this machine to jian')
  m.cswapAt = 'none'
  expect((await $.command.run(typed('gt'))).text).toContain("cswap isn't installed here (uv tool install claude-swap)")
})

test('/auth to an expired or missing login says how to sign in', async ($, on) => {
  const m = new Machine('gt@example.com')
  m.saved = [
    { number: 1, email: 'gt@example.com' },
    { number: 2, email: 'ut@example.com', organizationUuid: UT_ORG, usageStatus: 'relogin_required' },
  ]
  m.engine(on)
  const expiredText = (await $.command.run(typed('ut'))).text
  expect(expiredText).toContain('has expired')
  expect(expiredText).toContain('claude auth login --email ut@example.com')
  const missing = (await $.command.run(typed('jian'))).text
  expect(missing).toContain("isn't saved on this machine yet")
  // Each time, the current login is saved again first: the sign-in writes over it.
  expect(changes(m)).toEqual([['add'], ['add']])
})

test('/auth keeps each new sign-in, so signing in to the next account cannot lose it', async ($, on) => {
  // ut and gt were saved long ago and have expired; the machine is on jian, which cswap doesn't have.
  const m = new Machine('jian@example.com')
  m.saved = [
    { number: 1, email: 'ut@example.com', organizationUuid: UT_ORG, usageStatus: 'relogin_required', creds: 'dead' },
    { number: 2, email: 'gt@example.com', usageStatus: 'relogin_required', creds: 'dead' },
  ]
  m.engine(on)
  expect((await $.command.run(typed('ut'))).text).toContain('claude auth login --email ut@example.com')
  m.signIn('ut@example.com', UT_ORG)
  const ut = m.liveCreds
  const saved = (await $.command.run(typed('ut'))).text
  expect(saved).toContain('Already on ut')
  expect(saved).toContain('Saved this login in cswap')
  expect((await $.command.run(typed('gt'))).text).toContain('claude auth login --email gt@example.com')
  m.signIn('gt@example.com')
  await $.command.run(typed('gt'))
  expect((await $.command.run(typed('ut'))).text).toContain('Switched this machine to ut')
  expect(m.liveCreds).toBe(ut)
  expect((await $.command.run(typed('jian'))).text).toContain('Switched this machine to jian')
  expect(m.liveCreds).toBe('login-0')
})

test('/auth to the current account saves its login again; to an unknown one changes nothing', async ($, on) => {
  const m = new Machine('gt@example.com')
  m.saved = [{ number: 1, email: 'gt@example.com' }]
  m.engine(on)
  expect((await $.command.run(typed('GT'))).text).toContain('Already on gt')
  expect((await $.command.run(typed('nobody'))).text).toContain('no account "nobody"')
  expect(changes(m)).toEqual([['add']])
  expect(m.live()?.email).toBe('gt@example.com')
})
