import type { Change } from '../types'
import { expect, mock, test } from 'claude-code/testing'

type Dollar = Parameters<Parameters<typeof test>[1]>[0]
type On = Parameters<Parameters<typeof test>[1]>[1]

const NOW = 1_700_000_000_000

const TASKS = `# Tasks

## 1. Setup

- [x] 1.1 Create the module
- [ ] 1.2 Add \`fields\`

## 2. Build

- [ ] 2.1 Wire it
- [ ] 2.2 Test it

## Notas

- not a task
`

const ALL_DONE = '## 1. A\n\n- [x] 1.1 One\n'

/** The artifacts of a change that is ready to be applied. */
function planned(name: string, tasks: string): Record<string, string> {
  const base = `/project/openspec/changes/${name}`
  return {
    [`${base}/.openspec.yaml`]: 'schema: spec-driven\ncreated: 2026-01-01\n',
    [`${base}/proposal.md`]: '# Why',
    [`${base}/design.md`]: '# How',
    [`${base}/specs/thing/spec.md`]: '## ADDED Requirements',
    [`${base}/tasks.md`]: tasks,
  }
}

/**
 * Stubs a project: `files` maps a path to its text; folders follow from the
 * paths. `mtimes` gives the last write of a file.
 */
function project(
  $: Dollar,
  on: On,
  files: Record<string, string>,
  mtimes: Record<string, number> = {},
  placement: { isPlaced: boolean; reason?: string } = { isPlaced: true },
): string[] {
  const opened: string[] = []
  on('session.root', () => ({ value: '/project' }))
  on('fs.list', (_$, e) => {
    const prefix = `${String(e.path)}/`
    const found = new Map<string, 'file' | 'dir'>()
    for (const path of Object.keys(files)) {
      if (path.startsWith(prefix)) {
        const [first, ...rest] = path.slice(prefix.length).split('/')
        found.set(first ?? '', rest.length > 0 ? 'dir' : 'file')
      }
    }
    if (found.size === 0) {
      return { deny: 'missing' }
    }
    return { value: [...found].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('fs.read', (_$, e) => (String(e.path) in files ? { value: files[String(e.path)] } : { deny: 'missing' }))
  on('fs.exists', (_$, e) => ({ value: String(e.path) in files }))
  on('fs.stat', (_$, e) => (String(e.path) in files
    ? { value: { kind: 'file', size: 0, mtimeMs: mtimes[String(e.path)] ?? 0, isLink: false } }
    : { deny: 'missing' }))
  on('ui.open', (_$, e) => {
    opened.push(String((e as unknown as { id: string }).id))
    return { value: placement }
  })
  // The model turns are the engine's: a test only has them answer.
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  return opened
}

const PANE = {
  plugin: 'openspec-pane',
  component: 'Pane',
  requestId: 'openspec-pane',
  props: {
    title: 'OpenSpec',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const THREE = {
  ...{ '/project/openspec/changes/plan/tasks.md': TASKS },
  ...planned('mid', TASKS),
  ...planned('fin', ALL_DONE),
}

test('reads the artifacts and the tasks of active changes for the pane', async ($, on) => {
  project($, on, { ...THREE, '/project/openspec/changes/archive/2026-10-13-old/tasks.md': ALL_DONE })
  mock.clock(on, { now: NOW })
  let changes: Change[] = []
  on('state.set', (_$, e, next) => {
    if ((e as unknown as { key: string }).key === 'changes') {
      changes = (e as unknown as { value: Change[] }).value
    }
    return next(e)
  })

  const answer = await $.command.run({ command: 'openspec' })
  expect(answer).toEqual(expect.objectContaining({ text: 'OpenSpec pane opened.' }))

  expect(changes.map(change => [change.name, change.done, change.total])).toEqual([
    // Oldest first: plan has no .openspec.yaml, so its folder's time counts.
    ['plan', 1, 4],
    ['fin', 1, 1],
    ['mid', 1, 4],
  ])
  expect(changes.find(change => change.name === 'plan')?.artifacts).toEqual({ proposal: false, specs: false, design: false, tasks: true })
  expect(changes.find(change => change.name === 'mid')?.artifacts).toEqual({ proposal: true, specs: true, design: true, tasks: true })
  expect(changes[2]?.groups[0]?.tasks[1]).toEqual({ label: '1.2 Add fields', isDone: false })
})

test('puts each change in the stage OpenSpec gives it', async ($, on) => {
  project($, on, THREE)
  mock.clock(on, { now: NOW })
  await $.command.run({ command: 'openspec' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const names = async () => (await ui.findAll({ type: 'Text', text: /^(plan|mid|fin)$/ })).map(row => row.text)
  await ui.press({ plugin: 'openspec-pane', key: 'tab-planning' })
  expect(await names()).toEqual(['plan'])
  expect((await ui.find({ type: 'Text', text: /proposal ○ · specs ○ · design ○ · tasks ✓/ }))?.text).toBeDefined()
  await ui.press({ plugin: 'openspec-pane', key: 'tab-apply' })
  expect(await names()).toEqual(['mid'])
  await ui.press({ plugin: 'openspec-pane', key: 'tab-ready' })
  expect(await names()).toEqual(['fin'])
  await ui.unmount()
})

test('lists the archive folder in the archived tab', async ($, on) => {
  project($, on, { '/project/openspec/changes/archive/2026-10-13-site-languages/tasks.md': TASKS })
  mock.clock(on, { now: NOW })
  await $.command.run({ command: 'openspec' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ plugin: 'openspec-pane', key: 'tab-archived' })
  expect((await ui.find({ type: 'Text', text: /site-languages/ }))?.text).toContain('2026-10-13-site-languages 1/4')
  await ui.unmount()
})

/** Presses a button with the commands the session has, and reports what ran. */
async function press($: Dollar, on: On, tab: string, key: string, available: string[]): Promise<{ ran: { command: string; args: string }[]; toasts: string[] }> {
  const ran: { command: string; args: string }[] = []
  const toasts: string[] = []
  project($, on, THREE)
  mock.clock(on, { now: NOW })
  on('command.list', () => ({ value: available.map(name => ({ name, description: '', source: 'plugin' })) }))
  on('ui.toast', (_$, e) => {
    toasts.push(String((e as unknown as { text: string }).text))
    return { value: undefined }
  })
  on('command.run', (_$, e) => {
    if (e.command !== 'openspec') {
      ran.push({ command: e.command, args: e.args })
      return { text: '' }
    }
    return undefined as never
  })
  await $.command.run({ command: 'openspec' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ plugin: 'openspec-pane', key: `tab-${tab}` })
  await ui.press({ plugin: 'openspec-pane', key })
  await ui.unmount()
  return { ran, toasts }
}

test('the buttons run the command of OpenSpec for the stage, never a program', async ($, on) => {
  const result = await press($, on, 'ready', 'ready-fin', ['opsx:propose', 'opsx:apply', 'opsx:archive'])
  expect(result.ran).toEqual([{ command: 'opsx:archive', args: 'fin' }])
})

test('falls back to the skill of OpenSpec when the command file is missing', async ($, on) => {
  const result = await press($, on, 'apply', 'apply-mid', ['openspec-apply-change'])
  expect(result.ran).toEqual([{ command: 'openspec-apply-change', args: 'mid' }])
})

test('says so when the session has no command for the button', async ($, on) => {
  const result = await press($, on, 'planning', 'planning-plan', ['compact'])
  expect(result.ran).toEqual([])
  expect(result.toasts[0]).toContain('/opsx:propose')
})

const TURN = (turnId: string, text: string) => ({ turnId, text }) as never
const END = (turnId: string) => ({ turnId, answer: '', durationMs: 1, isAborted: false, reason: 'answer' }) as never

test('shows in green the task an agent works on, with a spinner, until the turn ends', async ($, on) => {
  project($, on, THREE)
  mock.clock(on, { now: NOW })
  await $.command.run({ command: 'openspec' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ plugin: 'openspec-pane', key: 'tab-apply' })
  expect(await ui.find({ type: 'Text', text: /▶/ })).toBeUndefined()

  // Names the change only: the first pending task is the one being applied.
  await $.turn.start(TURN('t1', '/opsx:apply mid'))
  const first = await ui.find({ type: 'Text', text: /▶ 1\.2 Add fields/ })
  expect(first).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /running 0s/ })).toBeDefined()

  await $.turn.complete(END('t1'))
  expect(await ui.find({ type: 'Text', text: /▶/ })).toBeUndefined()

  // Names a task: that one.
  await $.turn.start(TURN('t2', 'Subagent: implement 2.2 of the change mid'))
  expect(await ui.find({ type: 'Text', text: /▶ 2\.2 Test it/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▶ 1\.2/ })).toBeUndefined()
  await $.turn.complete(END('t2'))
  await ui.unmount()
})

test('does not show a turn that names no change', async ($, on) => {
  project($, on, THREE)
  mock.clock(on, { now: NOW })
  await $.command.run({ command: 'openspec' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ plugin: 'openspec-pane', key: 'tab-apply' })

  await $.turn.start(TURN('t1', 'hello there'))
  expect(await ui.find({ type: 'Text', text: /▶|running/ })).toBeUndefined()
  await ui.unmount()
})

test('gives a turn that names no change the one whose tasks were written since it began', async ($, on) => {
  const mtimes: Record<string, number> = {}
  project($, on, THREE, mtimes)
  mock.clock(on, { now: NOW })
  await $.command.run({ command: 'openspec' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ plugin: 'openspec-pane', key: 'tab-apply' })

  await $.turn.start(TURN('t1', 'go on with it'))
  mtimes['/project/openspec/changes/mid/tasks.md'] = NOW + 1000
  await $.command.run({ command: 'openspec' })
  expect(await ui.find({ type: 'Text', text: /▶ 1\.2 Add fields/ })).toBeDefined()
  await ui.unmount()
})

/**
 * Starts a session with the given change folders and reports the panes opened.
 */
async function startWith($: Dollar, on: On, names: string[], open: string[]): Promise<string[]> {
  const opened = project($, on, Object.fromEntries(names.map(name => [`/project/openspec/changes/${name}/tasks.md`, TASKS])))
  mock.clock(on, { now: NOW })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: {} }))
  on('ui.panes', () => ({
    value: open.map(id => ({ id, title: 'OpenSpec', isShown: true, isFocused: false, isPlaced: true })),
  }))
  await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
  return opened
}

test('opens the pane at session start when there are active changes', async ($, on) => {
  expect(await startWith($, on, ['archive', 'multi-tcg-catalog'], [])).toEqual(['openspec-pane'])
})

test('does not open the pane without active changes', async ($, on) => {
  expect(await startWith($, on, ['archive'], [])).toEqual([])
})

test('does not open the pane twice', async ($, on) => {
  expect(await startWith($, on, ['multi-tcg-catalog'], ['openspec-pane'])).toEqual([])
})

test('says why when the pane is not shown', async ($, on) => {
  project($, on, {}, {}, { isPlaced: false, reason: 'no surface places panes' })
  mock.clock(on, { now: NOW })

  const answer = await $.command.run({ command: 'openspec' })
  expect(answer).toEqual(expect.objectContaining({ text: 'OpenSpec pane not shown: no surface places panes' }))
})

test('reads the changes from the project root, wherever the shell went', async ($, on) => {
  const listed: string[] = []
  on('session.root', () => ({ value: '/project' }))
  on('fs.list', (_$, e) => {
    listed.push(String(e.path))
    return { value: [] }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  mock.clock(on, { now: NOW })
  await $.command.run({ command: 'openspec' })
  expect(listed).toEqual(['/project/openspec/changes', '/project/openspec/changes/archive'])
})
