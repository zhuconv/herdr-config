// Short names.
//
// For slash commands:
// - Typing a space after one turns it into the full name in the box:
//   `/ren ` becomes `/rename `, so Enter sends the real command with its
//   arguments, as if it had been typed in full.
// - `/u` and Enter (nothing after it) runs `/usage`: each short name is also a
//   command of its own, which runs the full one.
//
// To add or change one, edit SHORT: the key is what you type (letters, digits,
// `_`, `-`; not a built-in's name or alias), the value the command it stands for.
//
// For a new session: it names itself, the way a chat app titles a
// conversation. From the first message that holds a task, Haiku sums the work
// up in two or three lowercase words joined by hyphens (`oauth-retry`,
// `csv-export`), not the message's opening words. The name is the session's
// own, as /rename gives it: the prompt box's frame, the terminal's title (which
// Herdr, hc and the phone show) and /resume carry it.
// - A session with a name keeps it: one from /rename, `claude -n` or a fork.
// - Only the first prompts of a new session, and only the person's: `-p`
//   runs, peers' messages and wakeups are left alone, and a resumed session
//   with a history keeps going unnamed.
// - The prompt waits for the name, a second or so, at most NAME_TIMEOUT_MS.
//   When the call fails, or the message holds no task yet ("continue", a
//   greeting), the next prompt tries again, up to the NAME_WITHIN-th.
// One file on purpose: the servers run older builds of Claude Code than this
// Mac, and every one of them loads a single-file module.
import type { EngineInterface, Hook, Register } from 'claude-code'

const SHORT: Record<string, string> = {
  ren: 'rename',
  u: 'usage',
  m: 'model',
  st: 'status',
}

// The dim hint after the name in the typeahead, for commands that take one.
const HINT: Record<string, string> = {
  rename: '[name]',
  model: '[model]',
}

// `/ren foo` → `/rename foo`; anything else unchanged.
function expand(text: string): string {
  const [, name = '', rest = ''] = /^\/([A-Za-z0-9_-]+)(\s[\s\S]*)$/.exec(text) ?? []
  const full = Object.hasOwn(SHORT, name) ? SHORT[name] : undefined

  return full ? `/${full}${rest}` : text
}

type PromptSubmit = Parameters<Hook<'classic.UserPromptSubmit'>>[1]

/** A session still unnamed after this many prompts stays so. */
const NAME_WITHIN = 3
/** The longest name, in characters. */
export const NAME_MAX = 20
/** How long a prompt may wait for its session's name. */
const NAME_TIMEOUT_MS = 6000

const ASK = `You name coding-agent sessions. Given a session's first message, answer with a short name for the session, the way a chat app titles a conversation: say what the work is about, never copy the message's opening words.

The name:
- is one to three lowercase English words joined by hyphens, two when they say enough, at most ${NAME_MAX} characters, like pane-header, oauth-retry, csv-export, paper-intro or gpu-oom;
- keeps a project, tool or file name the message centers on, in lowercase;
- is English even when the message is not.

Skip boilerplate, such as a role line ("You are a worker...") or a pasted log, and name the task itself. When the message holds no task yet (a greeting, "continue", a bare question mark), answer none.

Answer with the name alone.`

/** The part of a prompt worth naming: hc's envelope and reminders dropped, at most 3,000 characters. */
export function gist(prompt: string): string {
  return prompt
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ')
    .replace(/<\/?hc\b[^>]*>/g, ' ')
    .trim()
    .slice(0, 3000)
}

/** The model's answer as a name (lowercase words joined by hyphens, at most NAME_MAX), or null for none. */
export function asName(reply: string): string | null {
  const line = (reply.trim().split('\n')[0] ?? '').replace(/^\s*name\s*:\s*/i, '')
  const name = line
    .toLowerCase()
    .replace(/[\s_/]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  if (name.length < 2 || name === 'none') return null
  if (name.length <= NAME_MAX) return name
  // Too long: whole words up to NAME_MAX, else its first NAME_MAX characters.
  const cut = name.slice(0, NAME_MAX + 1).lastIndexOf('-')
  return cut >= 2 ? name.slice(0, cut) : name.slice(0, NAME_MAX).replace(/-$/, '')
}

/** Whether this prompt may name its session, before anything is asked of the engine. */
function wanted(e: PromptSubmit): boolean {
  if (e.session_title?.trim()) return false
  if (e.source !== undefined && e.source !== 'user') return false
  return gist(e.prompt).replace(/\s/g, '').length >= 4
}

async function nameFor($: EngineInterface, prompt: string): Promise<string | null> {
  if ((await $.session.turns()) >= NAME_WITHIN) return null
  const r = await $.model.complete({
    model: 'haiku',
    system: ASK,
    prompt: `<message>\n${gist(prompt)}\n</message>\n\nThe session's name:`,
    maxTokens: 30,
    effort: 'low',
    timeoutMs: NAME_TIMEOUT_MS,
  })
  return r.isAnswered ? asName(r.text) : null
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const [short, full] of Object.entries(SHORT)) {
      await $.command.register({
        name: short,
        description: `/${full}`,
        immediate: true,
        ...(HINT[full] ? { argumentHint: HINT[full] } : {}),
      })
    }

    return next(e)
  })

  // The space after a short name: rewrite the box so it holds the full name.
  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    const text = expand(box.text)
    if (text === box.text) return box

    const grew = text.length - box.text.length
    const nameEnd = box.text.search(/\s/)

    return { ...box, text, cursor: box.cursor >= nameEnd ? box.cursor + grew : box.cursor }
  })

  for (const [short, full] of Object.entries(SHORT)) {
    // `/u` sent as is. The full command runs once this one has returned: a
    // command can't wait on another from inside its own run.
    on('command.run', { command: short }, async ($, e) => {
      $.clock.after(0, () => {
        $.command.run({ command: full, args: e.args }).catch(err => {
          $.ui.toast(`/${short}: /${full} didn't run: ${err instanceof Error ? err.message : String(err)}`)
        })
      })

      return {}
    })
  }

  // A new session's name, asked alongside the settings' own hooks so they take
  // no extra time; it rides the prompt's result as a hook's `sessionTitle`. A
  // build without the event keeps the short names above.
  try {
    on('classic.UserPromptSubmit', async ($, e, next) => {
      const naming = wanted(e) ? nameFor($, e.prompt).catch(() => null) : null
      const result = await next(e)
      const name = naming && (await naming)
      return name && !result.block && !result.sessionTitle ? { ...result, sessionTitle: name } : result
    })
  } catch {
    // An older Claude Code: no session names.
  }
}
