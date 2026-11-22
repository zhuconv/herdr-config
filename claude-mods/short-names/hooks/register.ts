// Short names.
//
// For a new session: it names itself from its first message, in two or three
// words (session-name.ts).
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
import type { Register } from 'claude-code'
import { nameSessions } from './session-name'

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

export const register: Register = on => {
  nameSessions(on)

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
}
