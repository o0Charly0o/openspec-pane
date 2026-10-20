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
    changes = (e as unknown as { value: Change[] }).value
    return next(e)
  })

  const answer = await $.command.run({ command: 'openspec' })
  expect(answer).toEqual(expect.objectContaining({ text: 'OpenSpec pane opened.' }))

  expect(changes.map(change => [change.name, change.done, change.total])).toEqual([
    ['user-library', 1, 2],
    ['empty', 0, 0],
  ])
  expect(changes[0]?.groups[0]?.tasks[1]).toEqual({ label: '1.2 Add fields', isDone: false })
})

/**
 * Starts a session with the given change folders and reports the panes opened.
 */
async function startWith($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1], names: string[], open: string[]): Promise<string[]> {
  const opened: string[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: {} }))
  on('session.root', () => ({ value: '/project' }))
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
  on('fs.list', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'no surface places panes' } }))

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
  await $.command.run({ command: 'openspec' })
  expect(listed).toEqual(['/project/openspec/changes'])
})
