import type { Change } from '../types'
import { expect, test } from 'claude-code/testing'

const TASKS = `# Tasks

## 1. Setup

- [x] 1.1 Create the module
- [ ] 1.2 Add \`fields\`

## Notas

- not a task
`

test('loads the tasks of active changes for the pane', async ($, on) => {
  on('session.root', () => ({ value: '/project' }))
  on('store.get', () => ({ value: undefined }))
  on('fs.list', () => ({
    value: [
      { name: 'archive', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
      { name: 'user-library', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
      { name: 'empty', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
    ],
  }))
  on('fs.read', (_$, e) => {
    if (String(e.path).includes('user-library')) {
      return { value: TASKS }
    }
    return { deny: 'missing' }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
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
    ['empty', 0, 0],
    ['user-library', 1, 2],
  ])
  expect(changes[1]?.groups[0]?.tasks[1]).toEqual({ label: '1.2 Add fields', isDone: false })
})

/**
 * Starts a session with the given change folders and reports the panes opened.
 */
async function startWith($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1], names: string[], open: string[]): Promise<string[]> {
  const opened: string[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: {} }))
  on('session.root', () => ({ value: '/project' }))
  on('store.get', () => ({ value: undefined }))
  on('fs.list', () => ({
    value: names.map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', () => ({ value: TASKS }))
  on('ui.panes', () => ({
    value: open.map(id => ({ id, title: 'OpenSpec', isShown: true, isFocused: false, isPlaced: true })),
  }))
  on('ui.open', (_$, e) => {
    opened.push(String((e as unknown as { id: string }).id))
    return { value: { isPlaced: true } }
  })
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
  on('session.root', () => ({ value: '/project' }))
  on('store.get', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'no surface places panes' } }))

  const answer = await $.command.run({ command: 'openspec' })
  expect(answer).toEqual(expect.objectContaining({ text: 'OpenSpec pane not shown: no surface places panes' }))
})

test('reads the changes from the project root, wherever the shell went', async ($, on) => {
  const listed: string[] = []
  on('session.root', () => ({ value: '/project' }))
  on('store.get', () => ({ value: undefined }))
  on('fs.list', (_$, e) => {
    listed.push(String(e.path))
    return { value: [] }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'openspec' })
  expect(listed).toEqual(['/project/openspec/changes', '/project/openspec/changes/archive'])
})

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

test('lists the changes of a phase, the oldest first', async ($, on) => {
  const created: Record<string, string> = { old: '2026-01-01', recent: '2026-03-01', done: '2025-12-01' }
  on('session.root', () => ({ value: '/project' }))
  on('store.get', () => ({ value: undefined }))
  on('fs.list', () => ({
    value: ['recent', 'done', 'old'].map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', (_$, e) => {
    const [, name, file] = String(e.path).match(/changes\/([^/]+)\/(.+)$/) ?? []
    if (file === '.openspec.yaml') {
      return { value: `schema: spec-driven\ncreated: ${created[name ?? '']}\n` }
    }
    return { value: name === 'done' ? '## 1. A\n\n- [x] 1.1 One\n' : TASKS }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'openspec' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const names = async () => (await ui.findAll({ type: 'Text', text: /^(old|recent|done)$/ })).map(row => row.text)
  expect(await names()).toEqual(['old', 'recent'])
  await ui.press({ plugin: 'openspec-pane', key: 'tab-done' })
  expect(await names()).toEqual(['done'])
  await ui.unmount()
})

test('starts a change from the backlog and keeps it', async ($, on) => {
  const saved: Record<string, unknown> = {}
  on('session.root', () => ({ value: '/project' }))
  on('store.get', (_$, e) => ({ value: saved[String(e.key)] }))
  on('store.set', (_$, e) => {
    saved[String(e.key)] = e.value
    return { value: undefined }
  })
  on('fs.list', () => ({ value: [{ name: 'idea', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }))
  on('fs.read', () => ({ value: '## 1. A\n\n- [ ] 1.1 One\n' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'openspec' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ plugin: 'openspec-pane', key: 'tab-backlog' })
  await ui.press({ plugin: 'openspec-pane', key: 'start-idea' })
  expect(saved['started:/project']).toEqual(['idea'])
  expect(await ui.find({ type: 'Button', key: 'start-idea' })).toBeUndefined()
  await ui.press({ plugin: 'openspec-pane', key: 'tab-progress' })
  expect(await ui.find({ type: 'Button', key: 'back-idea' })).toBeDefined()
  await ui.unmount()
})

test('lists the archive folder in the archived tab', async ($, on) => {
  on('session.root', () => ({ value: '/project' }))
  on('store.get', () => ({ value: undefined }))
  on('fs.list', (_$, e) => ({
    value: String(e.path).endsWith('/archive')
      ? [{ name: '2026-10-13-site-languages', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }]
      : [{ name: 'archive', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }],
  }))
  on('fs.read', () => ({ value: TASKS }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'openspec' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ plugin: 'openspec-pane', key: 'tab-archived' })
  expect((await ui.find({ type: 'Text', text: /site-languages/ }))?.text).toContain('2026-10-13-site-languages 1/2')
  await ui.unmount()
})

test('the archive button runs openspec archive for the change', async ($, on) => {
  const ran: string[][] = []
  on('session.root', () => ({ value: '/project' }))
  on('store.get', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [{ name: 'done', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }))
  on('fs.read', () => ({ value: '## 1. A\n\n- [x] 1.1 One\n' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', (_$, e) => {
    ran.push([...e.argv])
    return { value: { exitCode: 0, stdout: 'Change archived', stderr: '' } }
  })
  on('ui.toast', () => ({ value: undefined }))
  await $.command.run({ command: 'openspec' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ plugin: 'openspec-pane', key: 'tab-done' })
  await ui.press({ plugin: 'openspec-pane', key: 'archive-done' })
  expect(ran[0]?.slice(-2)).toEqual(['openspec', 'done'])
  await ui.unmount()
})
