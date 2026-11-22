// A new session names itself, the way a chat app titles a conversation: from
// the first message that holds a task, Haiku sums the work up in two or three
// lowercase words joined by hyphens (`oauth-retry`, `csv-export`), not the
// message's opening words. The name is the session's own, as /rename gives
// it: the prompt box's frame, the terminal's title (which Herdr, hc and the
// phone show) and /resume carry it.
//
// - A session with a name keeps it: one from /rename, `claude -n` or a fork.
// - Only the first prompts of a new session, and only the person's: `-p`
//   runs, peers' messages and wakeups are left alone, and a resumed session
//   with a history keeps going unnamed.
// - The prompt waits for the name, a second or so, at most TIMEOUT_MS. When
//   the call fails, or the message holds no task yet ("continue", a
//   greeting), the next prompt tries again, up to the WITHIN-th.
import type { EngineInterface, Hook, On } from 'claude-code'

type PromptSubmit = Parameters<Hook<'classic.UserPromptSubmit'>>[1]

/** A session still unnamed after this many prompts stays so. */
const WITHIN = 3
/** The longest name, in characters. */
export const MAX = 20
/** How long a prompt may wait for its session's name. */
const TIMEOUT_MS = 6000

const ASK = `You name coding-agent sessions. Given a session's first message, answer with a short name for the session, the way a chat app titles a conversation: say what the work is about, never copy the message's opening words.

The name:
- is one to three lowercase English words joined by hyphens, two when they say enough, at most ${MAX} characters, like pane-header, oauth-retry, csv-export, paper-intro or gpu-oom;
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

/** The model's answer as a name (lowercase words joined by hyphens, at most MAX), or null for none. */
export function asName(reply: string): string | null {
  const line = (reply.trim().split('\n')[0] ?? '').replace(/^\s*name\s*:\s*/i, '')
  const name = line
    .toLowerCase()
    .replace(/[\s_/]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  if (name.length < 2 || name === 'none') return null
  if (name.length <= MAX) return name
  // Too long: whole words up to MAX, else its first MAX characters.
  const cut = name.slice(0, MAX + 1).lastIndexOf('-')
  return cut >= 2 ? name.slice(0, cut) : name.slice(0, MAX).replace(/-$/, '')
}

/** Whether this prompt may name its session, before anything is asked of the engine. */
function wanted(e: PromptSubmit): boolean {
  if (e.session_title?.trim()) return false
  if (e.source !== undefined && e.source !== 'user') return false
  return gist(e.prompt).replace(/\s/g, '').length >= 4
}

async function nameFor($: EngineInterface, prompt: string): Promise<string | null> {
  if ((await $.session.turns()) >= WITHIN) return null
  const r = await $.model.complete({
    model: 'haiku',
    system: ASK,
    prompt: `<message>\n${gist(prompt)}\n</message>\n\nThe session's name:`,
    maxTokens: 30,
    effort: 'low',
    timeoutMs: TIMEOUT_MS,
  })
  return r.isAnswered ? asName(r.text) : null
}

export function nameSessions(on: On): void {
  // Asked before the settings' own hooks run, so they take no extra time; the
  // name rides the prompt's result as a hook's `sessionTitle`.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    const naming = wanted(e) ? nameFor($, e.prompt).catch(() => null) : null
    const result = await next(e)
    const name = naming && (await naming)
    return name && !result.block && !result.sessionTitle ? { ...result, sessionTitle: name } : result
  })
}
