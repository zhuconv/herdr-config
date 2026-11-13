import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = process.env.HERDR_TEST_ROOT ?? resolve(import.meta.dirname, '..');
const codex = { key: 'codex', name: 'Codex', agent: true };
const claude = { key: 'claude', name: 'Claude Code', agent: true };
const automatic = { name: '6', named: false };

for (const file of ['my-projects/model.js', 'my-tabs/projects.js', 'my-agents/projects.js']) {
  const { nameOf, tabsOf } = await import(pathToFileURL(`${root}/herdr-app/mods/${file}`));
  const agent = (title, program = codex) => ({ title, program, address: 't43' });
  test(`${file}: Codex session name excludes its workspace suffix`, () => {
    assert.equal(nameOf(agent('⠧ c-logo | web-app'), automatic), 'c-logo');
    assert.equal(nameOf(agent('c-logo | web-app'), automatic), 'c-logo');
    assert.equal(nameOf(agent('c-logo'), automatic), 'c-logo');
    assert.equal(nameOf(agent('⠴ parser | renderer | my-repo'), automatic), 'parser | renderer');
    assert.equal(nameOf(agent('⠴ 修复图标 | 中文目录'), automatic), '修复图标');
  });
  test(`${file}: manual tab names and other agents stay intact`, () => {
    assert.equal(nameOf(agent('⠧ c-logo | my-repo'), { name: 'custom | label', named: true }), 'custom | label');
    assert.equal(nameOf(agent('✳ parser | renderer', claude), automatic), 'parser | renderer');
    assert.equal(nameOf(agent('Codex'), automatic), 'Codex');
  });
  test(`${file}: tab and project rows use the session name`, () => {
    const spaces = [{ id: 's1', index: 1, machine: null, tabs: [{ ...automatic, id: 'tb1', index: 1 }] }];
    const panes = [{ pane: 'p1', tab: 'tb1', terminal: 't43', title: '⠧ c-logo | web-app', program: codex, cwd: '/work/web-app' }];
    assert.equal(tabsOf(spaces, panes, [])[0].listed[0].name, 'c-logo');
  });
}
