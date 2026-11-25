// accounts: which Claude account a session runs as, for its artifact links
// and for switching accounts.
//
// - Each artifact link a session publishes gets the account's tag:
//   https://claude.ai/artifact/<id>#acct=<alias>. The Zen mod in
//   zen-config-monorepo (multi-cc-switcher) opens a tagged link in that
//   account's container, signed in as the account that published it. The
//   tagged link shows as a line under the call, and the model is told to give
//   that one.
// - /auth <alias> switches this machine's Claude login to that account with
//   cswap (claude-swap). /auth alone lists the accounts. A login cswap hasn't
//   saved yet is saved first: a switch would otherwise write over it.
//   For an account with no working login saved, /auth gives the steps to sign
//   in, and /auth to it afterwards saves the new login (`cswap add` updates an
//   account's slot in place). Signing in writes over the machine's login
//   without keeping a copy, so /auth updates cswap's copy of it first.
// - /auth-here <alias> runs this session alone as that account, leaving the
//   machine and its other sessions as they are; /auth-here off ends it. Its
//   model requests carry the token of the login cswap keeps for the account
//   (see /auth-here below).
//
// The account table is ~/.config/claude-accounts/accounts.json, the file the
// Zen mod reads: {"accounts": [{"alias": "gt", "email": "...", "org": "..."}]}.
// A login is oauthAccount in a Claude config file. A session's own is in
// $CLAUDE_CONFIG_DIR/.claude.json when `cswap run` started it, else in
// ~/.claude.json, the machine's login, which is the one /auth switches: it runs
// cswap with CLAUDE_CONFIG_DIR unset, even from a `cswap run` session.
//
// One file on purpose: the servers run older builds of Claude Code than this
// Mac, and every one of them loads a single-file module.
import type { Args, EngineInterface, Next, Register } from 'claude-code'

export type Entry = { alias: string; email: string | null; org: string | null }
export type Live = { email: string; org: string | null }
type Saved = {
  number: number
  email?: string
  organizationUuid?: string | null
  alias?: string | null
  usageStatus?: string | null
}

const TABLE = '.config/claude-accounts/accounts.json'
const ALIAS = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$/
const ARTIFACT = /^https:\/\/claude\.ai\/(?:code\/)?artifacts?\/[A-Za-z0-9-]+/

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** The link with `acct=<alias>` in its fragment, any earlier tag replaced. */
export function tag(url: string, alias: string): string {
  const at = url.indexOf('#')
  const base = at < 0 ? url : url.slice(0, at)
  const rest = at < 0 ? [] : url.slice(at + 1).split('&').filter(part => part && !part.startsWith('acct='))
  return `${base}#${[...rest, `acct=${encodeURIComponent(alias)}`].join('&')}`
}

/** The table's accounts, emails and organizations lowercased. */
export function entries(raw: unknown): Entry[] {
  const list = Array.isArray(raw) ? raw : (raw as { accounts?: unknown } | null)?.accounts
  if (!Array.isArray(list)) return []
  const out: Entry[] = []
  for (const item of list as Record<string, unknown>[]) {
    const alias = typeof item?.alias === 'string' ? item.alias.trim() : ''
    if (!ALIAS.test(alias)) continue
    const email = typeof item.email === 'string' && item.email.includes('@') ? item.email.trim().toLowerCase() : null
    const org = typeof item.org === 'string' && item.org.trim() ? item.org.trim().toLowerCase() : null
    out.push({ alias, email, org })
  }
  return out
}

/** The alias of the table entry for this login: same email, and the same
 *  organization where the table names one. */
export function aliasOf(table: Entry[], live: Live): string | null {
  const mine = table.filter(a => a.email === live.email)
  const hit = mine.find(a => a.org && a.org === live.org) ?? mine.find(a => !a.org || !live.org) ?? null
  return hit?.alias ?? null
}

async function home($: EngineInterface): Promise<string> {
  return (await $.env.get('HOME')) ?? ''
}

/** The config folder this session was started with (`cswap run` sets one). */
async function ownConfigDir($: EngineInterface): Promise<string | null> {
  return (await $.env.get('CLAUDE_CONFIG_DIR')) || null
}

async function readJson($: EngineInterface, path: string): Promise<unknown> {
  try {
    return JSON.parse(await $.fs.read(path))
  } catch {
    return null
  }
}

async function table($: EngineInterface): Promise<Entry[]> {
  return entries(await readJson($, `${await home($)}/${TABLE}`))
}

/** The login kept for a Claude config folder (null: the default one), found
 *  as Claude Code and cswap find it: <folder>/.config.json when there (an old
 *  layout), else .claude.json, which for the default folder is ~/.claude.json. */
async function loginIn($: EngineInterface, dir: string | null): Promise<Live | null> {
  const base = await home($)
  const config = ((await readJson($, `${dir ?? `${base}/.claude`}/.config.json`)) ??
    (await readJson($, `${dir ?? base}/.claude.json`))) as {
    oauthAccount?: { emailAddress?: unknown; organizationUuid?: unknown }
  } | null
  const account = config?.oauthAccount
  if (typeof account?.emailAddress !== 'string') return null
  return {
    email: account.emailAddress.toLowerCase(),
    org: typeof account.organizationUuid === 'string' ? account.organizationUuid.toLowerCase() : null,
  }
}

/** The account this session runs as: it publishes the session's artifacts. */
async function sessionAccount($: EngineInterface): Promise<Live | null> {
  return loginIn($, await ownConfigDir($))
}

/** The machine's login, the one /auth switches. */
async function machineAccount($: EngineInterface): Promise<Live | null> {
  return loginIn($, null)
}

const same = (a: Live | null, b: Live | null) => !!a && !!b && a.email === b.email && (!a.org || !b.org || a.org === b.org)

// --- /auth -------------------------------------------------------------------

/** Runs cswap on the machine's login: with the variables `cswap run` sets for
 *  a session unset, which cswap would otherwise follow to that session's own. */
export const UNSET = ['env', '-u', 'CLAUDE_CONFIG_DIR', '-u', 'CLAUDE_SECURESTORAGE_CONFIG_DIR'] as const

async function cswap($: EngineInterface, args: string[]) {
  let failure = ''
  for (const bin of ['cswap', `${await home($)}/.local/bin/cswap`]) {
    try {
      const r = await $.process.run([...UNSET, bin, ...args], { timeoutMs: 60_000 })
      // env exits 127 when it can't find the program.
      if (r.exitCode !== 127) return r
      failure = r.stderr.trim()
    } catch (err) {
      failure = message(err)
    }
  }
  throw new Error(`cswap isn't installed here (uv tool install claude-swap)${failure ? `: ${failure}` : ''}`)
}

async function savedAccounts($: EngineInterface): Promise<Saved[]> {
  const r = await cswap($, ['list', '--json'])
  if (r.exitCode !== 0) throw new Error(`cswap list failed: ${(r.stderr || r.stdout).trim().slice(0, 300)}`)
  const json = r.stdout.slice(r.stdout.indexOf('{'), r.stdout.lastIndexOf('}') + 1)
  const accounts = (JSON.parse(json) as { accounts?: Saved[] }).accounts
  return Array.isArray(accounts) ? accounts : []
}

function savedFor(saved: Saved[], email: string, org: string | null): Saved | null {
  return (
    saved.find(
      s =>
        s.email?.toLowerCase() === email &&
        (!org || !s.organizationUuid || s.organizationUuid.toLowerCase() === org),
    ) ?? null
  )
}

const expired = (s: Saved | null) => s?.usageStatus === 'relogin_required'

export function listing(accounts: Entry[], saved: Saved[], live: Live | null): string {
  const current = live && aliasOf(accounts, live)
  const lines = [`Claude accounts on this machine${current ? ` (now ${current})` : live ? ` (now ${live.email})` : ''}:`]
  const width = Math.max(4, ...accounts.map(a => a.alias.length))
  let unsigned = 0
  for (const a of accounts) {
    const s = a.email ? savedFor(saved, a.email, a.org) : null
    const isLive = !!live && a.alias === current
    const state = isLive
      ? s
        ? 'current'
        : 'current, not saved in cswap yet'
      : !a.email
        ? 'no email in the account table'
        : !s
          ? 'not signed in on this machine'
          : expired(s)
            ? 'login expired'
            : 'ready'
    if (state === 'not signed in on this machine' || state === 'login expired') unsigned++
    lines.push(`  ${a.alias.padEnd(width)}  ${(a.email ?? '').padEnd(28)}  ${state}`)
  }
  const extra = saved.filter(s => !accounts.some(a => a.email && s.email?.toLowerCase() === a.email))
  for (const s of extra) {
    lines.push(`  ${(s.alias ?? `#${s.number}`).padEnd(width)}  ${(s.email ?? '').padEnd(28)}  saved in cswap, not in the account table`)
  }
  if (unsigned) {
    lines.push('To sign in to each account not signed in here or expired, one after another, run ~/.claude/mods/accounts/signin in a terminal on this machine.')
  }
  lines.push('/auth <alias> switches this machine to that account.')
  return lines.join('\n')
}

function signInSteps(alias: string, email: string | null, why: string): string {
  if (!email) {
    return `${alias} has no email in ~/${TABLE}: add it there, sign in with \`claude auth login --email <email>\` in a terminal here, then run /auth ${alias} again.`
  }
  return [
    `${alias}'s login ${why}. To sign it in, run this in a terminal on this machine (it switches the machine to ${alias}):`,
    `  claude auth login --email ${email}`,
    `Its sign-in page opens in ${alias}'s container in Zen: click Authorize (on a server, paste the code it shows into that terminal).`,
    `Then run /auth ${alias} again to save the new login in cswap.`,
  ].join('\n')
}

/** For a session with a login of its own: that /auth leaves it as it is. */
async function ownLoginNote($: EngineInterface, accounts: Entry[], machine: Live | null): Promise<string | null> {
  if (!(await ownConfigDir($))) return null
  const own = await sessionAccount($)
  if (!own || same(own, machine)) return null
  const name = aliasOf(accounts, own) ?? own.email
  return `This session has a login of its own (CLAUDE_CONFIG_DIR, as \`cswap run\` sets), so it stays on ${name}.`
}

/** /auth <wanted>; `mine`: this session's /auth-here, for what its answers say about it. */
export async function auth($: EngineInterface, wanted: string, mine?: HereState): Promise<Said> {
  const accounts = await table($)
  const live = await machineAccount($)
  let saved = await savedAccounts($)
  if (!wanted) {
    const note = await ownLoginNote($, accounts, live)
    return { text: [listing(accounts, saved, live), ...(note ? [note] : []), ...hereNote(mine)].join('\n') }
  }

  const lower = wanted.toLowerCase()
  const entry = accounts.find(a => a.alias.toLowerCase() === lower) ?? null
  if (!entry && !saved.some(s => s.alias?.toLowerCase() === lower)) {
    const known = accounts.map(a => a.alias).join(', ') || `none: write ~/${TABLE}`
    return { text: `/auth: no account "${wanted}". Accounts: ${known}.` }
  }
  const lines: string[] = []
  const current = live ? (aliasOf(accounts, live) ?? live.email) : null
  /** `cswap add`: saves the machine's login, or updates cswap's copy of it. Null when it worked. */
  const saveLive = async () => {
    const add = await cswap($, ['add'])
    saved = await savedAccounts($)
    return add.exitCode === 0 ? null : (add.stderr || add.stdout).trim().slice(0, 300) || `exit ${add.exitCode}`
  }

  // A switch writes over a login cswap doesn't have: save it first.
  const liveWasSaved = !!live && !!savedFor(saved, live.email, live.org)
  if (live && !liveWasSaved) {
    const failed = await saveLive()
    if (failed !== null || !savedFor(saved, live.email, live.org)) {
      return { text: `Not switching: the current login (${live.email}) isn't saved in cswap, and \`cswap add\` failed${failed ? `: ${failed}` : ''}.` }
    }
    lines.push(`Saved the current login (${current}) in cswap first, so you can switch back.`)
  }

  const target = entry?.email
    ? savedFor(saved, entry.email, entry.org)
    : (saved.find(s => s.alias?.toLowerCase() === lower) ?? null)
  const email = entry?.email ?? target?.email?.toLowerCase() ?? null
  const name = entry?.alias ?? wanted

  if (email && same(live, { email, org: entry?.org ?? null })) {
    // The step after a sign-in: it puts the new login in cswap, over the expired copy there.
    if (!liveWasSaved) return { text: [...lines, `Already on ${name} (${email}).`].join('\n') }
    const failed = await saveLive()
    return {
      text: [
        ...lines,
        failed === null
          ? `Already on ${name} (${email}). Saved this login in cswap, so you can switch back to it.`
          : `Already on ${name} (${email}), but \`cswap add\` couldn't save this login: ${failed}`,
      ].join('\n'),
    }
  }
  if (!target || expired(target)) {
    // Signing in writes over the machine's login and, unlike a switch, keeps no copy of it. cswap's
    // copy can be older than the login (an expired one, before the last sign-in): update it first.
    if (liveWasSaved) {
      const failed = await saveLive()
      if (failed !== null) {
        lines.push(`Couldn't save the current login (${current}) in cswap first (\`cswap add\`: ${failed}). Signing in to ${name} replaces it.`)
      }
    }
    const why = target ? 'saved on this machine has expired' : "isn't saved on this machine yet"
    return { text: [...lines, signInSteps(name, email, why)].join('\n') }
  }

  const sw = await cswap($, ['switch', String(target.number)])
  if (sw.exitCode !== 0) {
    return { text: [...lines, `cswap switch failed: ${(sw.stderr || sw.stdout).trim().slice(0, 500)}`].join('\n') }
  }
  lines.push(`Switched this machine to ${name} (${target.email}). Running sessions here pick it up within about 30 seconds; new ones start on it.`)
  const note = await ownLoginNote($, accounts, await machineAccount($))
  if (note) lines.push(note)
  lines.push(...hereNote(mine))
  // The machine moved: the session's own login is read again at its next request.
  if (mine) mine.ownSeen = null
  return { text: lines.join('\n'), context: [`The person switched this machine's Claude account to "${name}" with /auth.`] }
}

// --- /auth-here --------------------------------------------------------------
//
// /auth-here <alias> runs this session alone as another account, for when moving
// the whole machine would move every other session with it. An http.fetch hook
// puts that account's token on each model request the engine sends to
// Anthropic's API, its subagents' included. The token is that of the login cswap
// keeps for the account, the one `cswap switch` would put on the machine; ./token
// reads it through cswap's own code and refreshes it near its expiry through
// cswap's gate. A refresh token works once, so a login has one keeper: cswap for
// its saved copy, Claude Code for the machine's own. So while the session's own
// login is that account (the machine switched to it), the requests keep their
// own token. The choice is kept per session id ($.store): a resume or a respawn
// keeps it, /auth-here off ends it. A request never waits on a token that can't
// be had: it goes with the session's own login, and the session says so.

/** The account /auth-here runs a session as. */
export type Here = { alias: string; email: string; org: string | null }
/** What ./token answers. */
type Answer = { token?: string; expiresAt?: number; active?: boolean; error?: string; dead?: boolean }
/** What a command answers. */
type Said = { text: string; context?: string[] }

/** Model requests to Anthropic's own API: the only ones given another token. */
export const MODEL_URL = /^https:\/\/api\.anthropic\.com\/v1\/messages(?:[/?#]|$)/
// A token is used until this close to its expiry: inside cswap's own margin (5
// minutes), so asking for it then refreshes it.
const MARGIN = 4 * 60_000
// How long the session's own login, read from its config file, stands.
const OWN_TTL = 10_000
// After a token couldn't be had, the session's own login carries its requests this long.
const RETRY = 60_000

const hereKey = (id: string) => `here:${id}`

/** Asks ./token for the account's token; `refresh` after the API refused the last one. */
async function askToken($: EngineInterface, h: Here, refresh: boolean): Promise<Answer> {
  let root = ''
  try {
    root = $.plugin.root
  } catch {
    // An older build: where install.sh puts the mod.
  }
  root ||= `${await home($)}/.claude/mods/accounts`
  const argv = [...UNSET, 'python3', `${root}/token`, h.email, ...(h.org ? [h.org] : []), ...(refresh ? ['--refresh'] : [])]
  const r = await $.process.run(argv, { timeoutMs: 30_000 })
  try {
    return JSON.parse(r.stdout.trim().split('\n').pop() ?? '') as Answer
  } catch {
    return { error: (r.stderr.trim().split('\n').pop() || `./token ended with ${r.exitCode}`).slice(0, 300) }
  }
}

/** /auth-here in one session: the account it runs as and the token on hand. */
export type HereState = {
  here: Here | null
  token: { alias: string; value: string; expiresAt: number } | null
  /** The API refused the token on hand, so the next one asked for is a refreshed one. */
  refused: boolean
  asking: Promise<string | null> | null
  failedAt: number
  ownSeen: { at: number; login: Live | null } | null
}

export const newHereState = (): HereState => ({ here: null, token: null, refused: false, asking: null, failedAt: 0, ownSeen: null })

/** What /auth's answers add while the session runs on its own. */
function hereNote(st: HereState | undefined): string[] {
  const h = st?.here
  return h ? [`This session runs as ${h.alias} on its own (/auth-here), whatever the machine is on; /auth-here off makes it follow the machine.`] : []
}

async function ownLogin($: EngineInterface, st: HereState): Promise<Live | null> {
  if (!st.ownSeen || Date.now() - st.ownSeen.at > OWN_TTL) st.ownSeen = { at: Date.now(), login: await sessionAccount($) }
  return st.ownSeen.login
}

function show($: EngineInterface, st: HereState) {
  $.ui.status(st.here ? `Account: ${st.here.alias}, this session only (/auth-here off)` : undefined)
}

async function setHere($: EngineInterface, st: HereState, next: Here | null) {
  st.here = next
  st.token = null
  st.refused = false
  st.failedAt = 0
  const key = hereKey(await $.session.id())
  if (next) await $.store.set(key, next)
  else await $.store.delete(key)
  show($, st)
}

function keep(st: HereState, h: Here, token: string, expiresAt: number | undefined): string {
  st.token = { alias: h.alias, value: token, expiresAt: typeof expiresAt === 'number' ? expiresAt : Date.now() + 60 * 60_000 }
  return token
}

async function fetchToken($: EngineInterface, st: HereState, h: Here): Promise<string | null> {
  const a = await askToken($, h, st.refused)
  st.refused = false
  if (st.here !== h || a.active) return null
  if (a.token) return keep(st, h, a.token, a.expiresAt)
  const why = a.error ?? 'no answer'
  if (a.dead) {
    await setHere($, st, null)
    $.ui.toast(`This session is back on its own login: ${h.alias}'s token can't be had here (${why}). /auth ${h.alias} gives the steps to sign in.`)
  } else {
    st.failedAt = Date.now()
    $.ui.toast(`For a minute this session runs on its own login: ${h.alias}'s token couldn't be had (${why}).`)
  }
  return null
}

/** The token this session's model requests carry; null: their own. */
async function tokenNow($: EngineInterface, st: HereState): Promise<string | null> {
  const h = st.here
  if (!h || Date.now() - st.failedAt < RETRY) return null
  if (same(await ownLogin($, st), { email: h.email, org: h.org })) return null
  const t = st.token
  if (t?.alias === h.alias && !st.refused && t.expiresAt - Date.now() > MARGIN) return t.value
  if (!st.asking) st.asking = fetchToken($, st, h).finally(() => (st.asking = null))
  return st.asking
}

/** At session start: the account kept for this session id, if any. */
export async function hereStart($: EngineInterface, st: HereState) {
  const kept = (await $.store.get(hereKey(await $.session.id()))) as Partial<Here> | undefined
  st.here =
    typeof kept?.alias === 'string' && typeof kept.email === 'string'
      ? { alias: kept.alias, email: kept.email, org: typeof kept.org === 'string' ? kept.org : null }
      : null
  show($, st)
}

/** /auth-here <wanted>. */
export async function authHere($: EngineInterface, st: HereState, wanted: string): Promise<Said> {
  const accounts = await table($)
  const own = await sessionAccount($)
  st.ownSeen = { at: Date.now(), login: own }
  const ownName = own ? (aliasOf(accounts, own) ?? own.email) : 'no login'
  const base = (await ownConfigDir($)) ? 'its own login' : "the machine's login"
  if (!wanted) {
    return {
      text: st.here
        ? `This session runs as ${st.here.alias} (${st.here.email}) on its own; ${base} is ${ownName}. /auth-here off puts it back.`
        : `This session runs on ${base} (${ownName}). /auth-here <alias> runs it alone as another account, leaving the machine and its other sessions as they are.`,
    }
  }
  if (/^(off|-)$/i.test(wanted)) {
    if (!st.here) return { text: `This session already runs on ${base} (${ownName}).` }
    const was = st.here.alias
    await setHere($, st, null)
    return {
      text: `This session is back on ${base} (${ownName}); it ran as ${was}.`,
      context: [`The person put this session back on ${base}, the Claude account "${ownName}", with /auth-here off. It ran as "${was}".`],
    }
  }

  const lower = wanted.toLowerCase()
  const entry = accounts.find(a => a.alias.toLowerCase() === lower) ?? null
  const saved = await savedAccounts($)
  const slot = entry?.email ? savedFor(saved, entry.email, entry.org) : (saved.find(s => s.alias?.toLowerCase() === lower) ?? null)
  if (!entry && !slot) {
    const known = accounts.map(a => a.alias).join(', ') || `none: write ~/${TABLE}`
    return { text: `/auth-here: no account "${wanted}". Accounts: ${known}.` }
  }
  const name = entry?.alias ?? wanted
  const email = (entry?.email ?? slot?.email ?? '').toLowerCase()
  if (!email || !slot) return { text: `${name} isn't signed in on this machine: cswap has no login for it. /auth ${name} gives the steps to sign in.` }
  if (expired(slot)) return { text: `${name}'s login saved on this machine has expired. /auth ${name} gives the steps to sign in again.` }

  const h: Here = { alias: name, email, org: entry?.org ?? slot.organizationUuid?.toLowerCase() ?? null }
  const isOwn = same(own, { email: h.email, org: h.org })
  // Asked now, so a token that can't be had is said here, not at the next request.
  const first = isOwn ? null : await askToken($, h, false)
  if (first && !first.token && !first.active) return { text: `Not switching: ${name}'s token couldn't be had (${first.error ?? 'no answer'}).` }
  await setHere($, st, h)
  if (first?.token) keep(st, h, first.token, first.expiresAt)
  const machine = await machineAccount($)
  const machineName = machine ? (aliasOf(accounts, machine) ?? machine.email) : 'no login'
  return {
    text: isOwn
      ? `This session stays on ${name} (${email}) from now on, even when the machine switches. /auth-here off makes it follow ${base} again.`
      : `This session now runs as ${name} (${email}), alone: the machine and its other sessions stay on ${machineName}. /auth-here off puts it back.`,
    context: [`The person switched this session's Claude account to "${name}" with /auth-here. The machine and its other sessions stay on "${machineName}".`],
  }
}

/** The http.fetch hook: each model request the engine sends, once per send, with
 *  /auth-here on carries that account's token in place of the session's own. */
export async function hereFetch($: EngineInterface, st: HereState, e: Args<'http.fetch'>, next: Next<'http.fetch'>) {
  if (!st.here || next.origin.plugin !== 'engine' || !MODEL_URL.test(e.url)) return next(e)
  const headers = e.init?.headers ?? {}
  // A login's request: one with an API key is left as it is.
  const key = Object.keys(headers).find(k => k.toLowerCase() === 'authorization')
  if (!key) return next(e)
  let bearer: string | null = null
  try {
    bearer = await tokenNow($, st)
  } catch {
    bearer = null
  }
  if (!bearer) return next(e)
  const r = await next({ ...e, init: { ...e.init, headers: { ...headers, [key]: `Bearer ${bearer}` } } })
  if ('value' in r && r.value?.status === 401 && st.token?.value === bearer) st.refused = true
  return r
}

// --- Hooks -------------------------------------------------------------------

export const register: Register = on => {
  const mine = newHereState()

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'auth',
      description: "Switch this machine's Claude account (cswap); alone, list the accounts",
      argumentHint: '[alias]',
    })
    await $.command.register({
      name: 'auth-here',
      description: "Run this session alone as another Claude account; off: back to the machine's",
      argumentHint: '[alias|off]',
    })
    try {
      await hereStart($, mine)
    } catch {
      // An older build without $.session.id or $.store: no account kept.
    }
    return next(e)
  })

  on('command.run', { command: 'auth' }, async ($, e) => {
    try {
      return await auth($, e.args.trim(), mine)
    } catch (err) {
      return { text: `/auth: ${message(err)}` }
    }
  })

  on('command.run', { command: 'auth-here' }, async ($, e) => {
    try {
      return await authHere($, mine, e.args.trim())
    } catch (err) {
      return { text: `/auth-here: ${message(err)}` }
    }
  })

  // Each model request the engine sends, once per send: with /auth-here on, it
  // carries that account's token in place of the session's own.
  on('http.fetch', ($, e, next) => hereFetch($, mine, e, next))

  // Missing table entries are said once per session, not at every publish.
  let toldMissing = false

  on('tool.call', { tool: 'Artifact' }, async ($, e, next) => {
    const r = await next(e)
    try {
      const input = e as { action?: string; asset?: boolean }
      if (r.deny !== undefined || r.isError || input.asset || (input.action && input.action !== 'publish')) return r
      const url = (r.result as { url?: unknown } | undefined)?.url
      if (typeof url !== 'string' || !ARTIFACT.test(url)) return r
      const live = await sessionAccount($)
      const alias = live ? aliasOf(await table($), live) : null
      if (!alias) {
        if (!toldMissing) {
          toldMissing = true
          $.ui.log(
            live
              ? `accounts: ${live.email} isn't in ~/${TABLE}, so artifact links stay untagged.`
              : "accounts: this session's account is unknown, so artifact links stay untagged.",
          )
        }
        return r
      }
      const link = tag(url, alias)
      $.ui.log(`Artifact link for ${alias}: ${link}`)
      return {
        ...r,
        context: [
          ...(r.context ?? []),
          `This artifact was published from the Claude account "${alias}". When you give the person its link, give ${link}: the tag opens it in that account in their browser.`,
        ],
      }
    } catch {
      return r
    }
  })
}
