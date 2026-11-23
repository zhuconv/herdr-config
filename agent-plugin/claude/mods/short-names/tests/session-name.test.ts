// A new session's name: asked of the model once per prompt while it has none, for the person's
// first prompts only, and made a few lowercase words.
import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { asName, gist, NAME_MAX as MAX } from '../hooks/register'

const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

/** The engine beneath: `turns` prompts so far, the model answering `reply`, no settings hook;
 *  what the model was asked. */
function engine(on: On, turns: number, reply: string | null) {
  const asked: string[] = []
  on('classic.UserPromptSubmit', () => ({}))
  on('session.turns', () => ({ value: turns }))
  on('model.complete', (_, e) => {
    asked.push(String(e.prompt))
    return {
      value:
        reply === null
          ? { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage }
          : { isAnswered: true, text: reply, usage },
    }
  })
  return asked
}

test('a new session takes the name the model gives its first message', async ($, on) => {
  const asked = engine(on, 0, 'OAuth retry')
  const r = await $.classic.UserPromptSubmit({
    prompt: '<hc from=gpu1/t4>Fix the OAuth token refresh: it retries forever</hc>',
    source: 'user',
  })
  expect(r.sessionTitle).toBe('oauth-retry')
  expect(asked).toHaveLength(1)
  expect(asked[0]).toContain('Fix the OAuth token refresh')
  expect(asked[0]).not.toContain('<hc')
})

test('a prompt with no source (older payloads) counts as the person’s', async ($, on) => {
  engine(on, 1, 'csv-export')
  const r = await $.classic.UserPromptSubmit({ prompt: 'Add a CSV export to the report page' })
  expect(r.sessionTitle).toBe('csv-export')
})

test('a session with a name keeps it, and the model is not asked', async ($, on) => {
  const asked = engine(on, 0, 'something-else')
  const r = await $.classic.UserPromptSubmit({ prompt: 'Rewrite the intro', source: 'user', session_title: 'paper' })
  expect(r.sessionTitle).toBeUndefined()
  expect(asked).toHaveLength(0)
})

test('a peer’s message, a wakeup or a -p run names nothing', async ($, on) => {
  const asked = engine(on, 0, 'oauth-retry')
  for (const source of ['system', 'sdk', 'loop_wakeup'] as const) {
    const r = await $.classic.UserPromptSubmit({ prompt: 'Fix the OAuth token refresh', source })
    expect(r.sessionTitle).toBeUndefined()
  }
  expect(asked).toHaveLength(0)
})

test('three prompts in, a session still unnamed stays so', async ($, on) => {
  const asked = engine(on, 3, 'oauth-retry')
  const r = await $.classic.UserPromptSubmit({ prompt: 'Now the logout path too', source: 'user' })
  expect(r.sessionTitle).toBeUndefined()
  expect(asked).toHaveLength(0)
})

test('no task yet, a failed call or a bare "ok" names nothing', async ($, on) => {
  const none = engine(on, 0, 'None.')
  expect((await $.classic.UserPromptSubmit({ prompt: 'hello there', source: 'user' })).sessionTitle).toBeUndefined()
  expect(none).toHaveLength(1)
  expect((await $.classic.UserPromptSubmit({ prompt: 'ok', source: 'user' })).sessionTitle).toBeUndefined()
  expect(none).toHaveLength(1)
})

test('a failed call leaves the session unnamed', async ($, on) => {
  engine(on, 0, null)
  const r = await $.classic.UserPromptSubmit({ prompt: 'Fix the OAuth token refresh', source: 'user' })
  expect(r.sessionTitle).toBeUndefined()
})

test('the answer becomes lowercase words joined by hyphens, at most MAX characters', () => {
  expect(asName('Name: `CSV Export`')).toBe('csv-export')
  expect(asName('**gpu_oom / debug**\nbecause the run dies')).toBe('gpu-oom-debug')
  expect(asName('none')).toBeNull()
  expect(asName('会话命名')).toBeNull()
  const long = asName('distributed-training-checkpoint-resume-fix') ?? ''
  expect(long.length <= MAX).toBe(true)
  expect(long).toBe('distributed-training')
  expect(asName('supercalifragilisticexpialidocious')).toBe('supercalifragilistic')
})

test('what is named leaves out reminders and hc’s envelope', () => {
  expect(gist('<system-reminder>x</system-reminder><hc from=a/t1>do it</hc>')).toBe('do it')
})
