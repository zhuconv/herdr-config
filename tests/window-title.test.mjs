import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = process.env.HERDR_TEST_ROOT ?? resolve(import.meta.dirname, '..');
const { windowTitle, titleOf } = await import(pathToFileURL(`${root}/herdr-app/mods/my-projects/title.js`));
const { tabsOf } = await import(pathToFileURL(`${root}/herdr-app/mods/my-projects/model.js`));

const claude = { key: 'claude', name: 'Claude Code', agent: true };
const codex = { key: 'codex', name: 'Codex', agent: true };
const zsh = { key: 'shell', name: 'zsh', shell: true };
const state = {
  projects: [
    { name: 'paper', dirs: ['|/Users/me/paper', 'gpu1|/home/me/paper'] },
    { name: 'bench', dirs: ['cluster|/work/0001/me/bench'] },
  ],
  loose: ['gpu1|/home/me/paper/scratch'],
};
const opts = { state };
// A conversation as main.js conversations() files it.
const conv = (pane, machine, cwd, name, program = claude, address = `${machine ? machine + '/' : ''}t${pane}`) =>
  ({ pane, address, machine, cwd, name, program, focused: false });

test('an agent goes by the project the panel files it under, with its name and program', () => {
  const convs = [conv('p1', 'gpu1', '/home/me/paper/worktrees/figures', 'fix-figures')];
  assert.equal(windowTitle({ pane: 'p1', terminal: 'gpu1/tp1' }, { ...opts, convs }), 'Herdr — paper · fix-figures · Claude Code');
});

test('this computer\'s folders and the panel\'s nearest-parent rule', () => {
  const convs = [conv('p1', null, '/Users/me/paper', 'notes'), conv('p2', 'gpu1', '/home/me/paper/scratch/x', 'try')];
  assert.equal(windowTitle({ pane: 'p1' }, { ...opts, convs }), 'Herdr — paper · notes · Claude Code');
  // A loose directory stays Unsorted although its parent is in paper.
  assert.equal(windowTitle({ pane: 'p2' }, { ...opts, convs }), 'Herdr — Unsorted · try · Claude Code');
});

test('a directory no project holds is Unsorted, as in the panel', () => {
  const convs = [
    conv('p1', null, '/Users/me/Downloads/a/b', 'misc'),
    conv('p2', 'cluster', '/home1/0001/me/tmp', 'probe', codex),
  ];
  assert.equal(windowTitle({ pane: 'p1' }, { ...opts, convs }), 'Herdr — Unsorted · misc · Claude Code');
  assert.equal(windowTitle({ pane: 'p2' }, { ...opts, convs }), 'Herdr — Unsorted · probe · Codex');
});

test('a conversation named only after its program leaves that part out', () => {
  const convs = [conv('p1', 'cluster', '/work/0001/me/bench', 'Claude Code')];
  assert.equal(windowTitle({ pane: 'p1' }, { ...opts, convs }), 'Herdr — bench · Claude Code');
});

test('a shell has no conversation and files as its tab does in the tab bar', () => {
  // Tab 1: Claude in paper with a shell split beside it in the home folder. Tab 2: a shell alone
  // in paper. Tab 3: a shell alone in a folder no project holds.
  const spaces = [{ id: 's1', index: 1, machine: 'gpu1', folder: '', tabs: [
    { id: 'tb1', index: 1, name: '1', named: false }, { id: 'tb2', index: 2, name: '2', named: false },
    { id: 'tb3', index: 3, name: '3', named: false }] }];
  const panes = [
    { pane: 'p1', tab: 'tb1', terminal: 'gpu1/t1', title: 'fix-figures', program: claude, cwd: '/home/me/paper' },
    { pane: 'p2', tab: 'tb1', terminal: 'gpu1/t2', title: '~', program: zsh, cwd: '/home/me' },
    { pane: 'p3', tab: 'tb2', terminal: 'gpu1/t3', title: '~/paper/app', program: zsh, cwd: '/home/me/paper/app' },
    { pane: 'p4', tab: 'tb3', terminal: 'gpu1/t4', title: '/tmp', program: zsh, cwd: '/tmp' },
  ];
  const convs = [conv('p1', 'gpu1', '/home/me/paper', 'fix-figures')];
  let made = 0;
  const tabs = () => { made++; return tabsOf(spaces, panes, []); };
  assert.equal(windowTitle({ pane: 'p1' }, { ...opts, convs, panes, tabs }), 'Herdr — paper · fix-figures · Claude Code');
  assert.equal(made, 0, 'an agent in focus needs no tabs');
  assert.equal(windowTitle({ pane: 'p2' }, { ...opts, convs, panes, tabs }), 'Herdr — paper · zsh');
  assert.equal(windowTitle({ pane: 'p3' }, { ...opts, convs, panes, tabs }), 'Herdr — paper · zsh');
  assert.equal(windowTitle({ pane: 'p4' }, { ...opts, convs, panes, tabs }), 'Herdr — Unsorted · zsh');
  assert.equal(windowTitle({ pane: 'p2' }, { ...opts, convs, panes, tabs: tabsOf(spaces, panes, []) }), 'Herdr — paper · zsh');
});

test('a mod pane goes by its name', () => {
  const panes = [{ pane: 'p9', tab: 'tb9', terminal: null, mod: 'agent-deck-overview', title: 'agent-deck-overview', name: null }];
  const tabs = [{ id: 'tb9', key: '|/Users/me/paper' }];
  assert.equal(windowTitle({ pane: 'p9' }, { ...opts, panes, tabs }), 'Herdr — paper · agent-deck-overview');
});

test('a peek: the terminal\'s own pane, else its manager\'s project, else its own folder\'s', () => {
  const convs = [conv('p1', 'gpu1', '/home/me/paper', 'manager')];
  const panes = [{ pane: 'p1', tab: 'tb1', terminal: 'gpu1/tp1', title: 'manager', program: claude, cwd: '/home/me/paper' }];
  const terminals = [
    { address: 'gpu1/tp1', parent: null, program: claude },
    { address: 'gpu1/t7', parent: 'gpu1/tp1', program: codex, cwd: '/tmp' },
    { address: 'gpu1/t8', parent: 'gpu1/t7', program: claude, title: 'deep-worker', cwd: '/tmp' },
    { address: 'cluster/t9', parent: null, program: claude, cwd: '/work/0001/me/bench' },
    { address: 'cluster/t10', parent: null, program: claude, title: 'loner', cwd: '/scratch/x' },
  ];
  const o = { ...opts, convs, panes, terminals };
  assert.equal(windowTitle({ pane: null, terminal: 'gpu1/tp1' }, o), 'Herdr — paper · manager · Claude Code');
  assert.equal(windowTitle({ pane: null, terminal: 'gpu1/t7' }, o), 'Herdr — paper · Codex');
  assert.equal(windowTitle({ pane: null, terminal: 'gpu1/t8' }, o), 'Herdr — paper · deep-worker · Claude Code');
  assert.equal(windowTitle({ pane: null, terminal: 'cluster/t9', cwd: '/work/0001/me/bench' }, o), 'Herdr — bench · Claude Code');
  assert.equal(windowTitle({ pane: null, terminal: 'cluster/t10' }, o), 'Herdr — Unsorted · loner · Claude Code');
});

test('nothing in focus: null, which Herdr shows as "Herdr"', () => {
  assert.equal(windowTitle(null, opts), null);
  assert.equal(windowTitle({ pane: null, terminal: null }, opts), null);
});

test('parts are one line each', () => {
  assert.equal(titleOf(' paper ', 'fix\n  the  build', 'Claude Code'), 'Herdr — paper · fix the build · Claude Code');
  assert.equal(titleOf('', '', ''), null);
});
