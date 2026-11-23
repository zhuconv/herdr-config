// accounts: which Claude account a session runs as, for its artifact links
// and for switching accounts.
//
// - Each artifact link a session publishes gets the account's tag:
//   https://claude.ai/artifact/<id>#acct=<alias>. The Zen mod in
//   zen-config-monorepo (zen-claude-accounts) opens a tagged link in that
//   account's container, signed in as the account that published it. The
//   tagged link shows as a line under the call, and the model is told to give
//   that one.
// - /auth <alias> switches this machine's Claude login to that account with
//   cswap (claude-swap). /auth alone lists the accounts. A login cswap hasn't
//   saved yet is saved first: a switch would otherwise write over it.
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
import type { EngineInterface, Register } from 'claude-code'

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
    lines.push(`  ${a.alias.padEnd(width)}  ${(a.email ?? '').padEnd(28)}  ${state}`)
  }
  const extra = saved.filter(s => !accounts.some(a => a.email && s.email?.toLowerCase() === a.email))
  for (const s of extra) {
    lines.push(`  ${(s.alias ?? `#${s.number}`).padEnd(width)}  ${(s.email ?? '').padEnd(28)}  saved in cswap, not in the account table`)
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

async function auth($: EngineInterface, wanted: string): Promise<{ text: string; context?: string[] }> {
  const accounts = await table($)
  const live = await machineAccount($)
  let saved = await savedAccounts($)
  if (!wanted) {
    const note = await ownLoginNote($, accounts, live)
    return { text: [listing(accounts, saved, live), ...(note ? [note] : [])].join('\n') }
  }

  const lower = wanted.toLowerCase()
  const entry = accounts.find(a => a.alias.toLowerCase() === lower) ?? null
  if (!entry && !saved.some(s => s.alias?.toLowerCase() === lower)) {
    const known = accounts.map(a => a.alias).join(', ') || `none: write ~/${TABLE}`
    return { text: `/auth: no account "${wanted}". Accounts: ${known}.` }
  }
  const lines: string[] = []

  // A switch writes over a login cswap hasn't saved: save it first.
  if (live && !savedFor(saved, live.email, live.org)) {
    const add = await cswap($, ['add'])
    saved = await savedAccounts($)
    if (add.exitCode !== 0 || !savedFor(saved, live.email, live.org)) {
      const why = (add.stderr || add.stdout).trim().slice(0, 300)
      return { text: `Not switching: the current login (${live.email}) isn't saved in cswap, and \`cswap add\` failed${why ? `: ${why}` : ''}.` }
    }
    lines.push(`Saved the current login (${aliasOf(accounts, live) ?? live.email}) in cswap first, so you can switch back.`)
  }

  const target = entry?.email
    ? savedFor(saved, entry.email, entry.org)
    : (saved.find(s => s.alias?.toLowerCase() === lower) ?? null)
  const email = entry?.email ?? target?.email?.toLowerCase() ?? null
  const name = entry?.alias ?? wanted

  if (email && same(live, { email, org: entry?.org ?? null })) {
    return { text: [...lines, `Already on ${name} (${email}).`].join('\n') }
  }
  if (!target || expired(target)) {
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
  return { text: lines.join('\n'), context: [`The person switched this machine's Claude account to "${name}" with /auth.`] }
}

// --- Hooks -------------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'auth',
      description: "Switch this machine's Claude account (cswap); alone, list the accounts",
      argumentHint: '[alias]',
    })
    return next(e)
  })

  on('command.run', { command: 'auth' }, async ($, e) => {
    try {
      return await auth($, e.args.trim())
    } catch (err) {
      return { text: `/auth: ${message(err)}` }
    }
  })

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
