import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Change, Group } from '../types'


const PANE = 'openspec-pane'
const changes = atom({ plugin: 'openspec-pane', key: 'changes' } as const, [])
const archive = atom({ plugin: 'openspec-pane', key: 'archive' } as const, [])
const tab = atom({ plugin: 'openspec-pane', key: 'tab' } as const, 'progress')
const started = atom({ plugin: 'openspec-pane', key: 'started' } as const, [])

type Stage = 'backlog' | 'progress' | 'done'

/**
 * The phase of an active change: nothing done yet is the backlog, until the
 * person starts it with the button; every task done is done; the rest is in
 * progress.
 */
function stageOf(change: Change, isStarted: boolean): Stage {
  if (change.total > 0 && change.done === change.total) {
    return 'done'
  }
  return change.done > 0 || isStarted ? 'progress' : 'backlog'
}

/** `███░░░░░░░` for 3 of 10. */
function bar(done: number, total: number): string {
  const filled = total > 0 ? Math.round((done / total) * 10) : 0
  return '█'.repeat(filled) + '░'.repeat(10 - filled)
}

/**
 * The changes the person started by hand are kept per project in the store of
 * the mod; the phases that follow from the tasks need no record.
 */
const storeKey = async ($: EngineInterface): Promise<string> => `started:${await $.session.root()}`

async function loadStarted($: EngineInterface): Promise<void> {
  const saved = await $.store.get(await storeKey($))
  await update($, started, () => (Array.isArray(saved) ? saved.map(String) : []))
}

async function setStarted($: EngineInterface, name: string, isStarted: boolean): Promise<void> {
  const key = await storeKey($)
  const saved = await $.store.get(key)
  const current = Array.isArray(saved) ? saved.map(String) : []
  const next = isStarted ? [...new Set([...current, name])] : current.filter(one => one !== name)
  await $.store.set(key, next)
  await update($, started, () => next)
}

/**
 * Counts and groups the checkboxes of a tasks.md.
 */
function parse(text: string): Pick<Change, 'done' | 'total' | 'groups'> {
  const groups: Group[] = []
  for (const line of text.split('\n')) {
    const heading = line.match(/^##\s+(.+)$/)?.[1]
    if (heading !== undefined) {
      // Notes and follow-up sections hold no tracked tasks.
      groups.push({ title: heading.trim(), tasks: [] })
      continue
    }
    const task = line.match(/^\s*- \[([ xX])\]\s+(.+)$/)
    const current = groups.at(-1)
    if (task && current) {
      current.tasks.push({ label: (task[2] ?? '').replace(/`/g, ''), isDone: task[1] !== ' ' })
    }
  }
  const tracked = groups.filter(group => group.tasks.length > 0)
  const all = tracked.flatMap(group => group.tasks)
  return { done: all.filter(t => t.isDone).length, total: all.length, groups: tracked }
}

async function readTasks($: EngineInterface, path: string): Promise<Pick<Change, 'done' | 'total' | 'groups'>> {
  try {
    return parse(String(await $.fs.read(`${path}/tasks.md`)))
  }
  catch {
    return { done: 0, total: 0, groups: [] }
  }
}

/**
 * When a change was started: the `created` date of its .openspec.yaml, else the
 * time its folder last changed.
 */
async function startedAt($: EngineInterface, path: string, fallback: number): Promise<number> {
  try {
    const created = String(await $.fs.read(`${path}/.openspec.yaml`)).match(/^created:\s*(\d{4}-\d{2}-\d{2})/m)?.[1]
    const time = created ? Date.parse(created) : Number.NaN
    return Number.isNaN(time) ? fallback : time
  }
  catch {
    return fallback
  }
}

/**
 * Reads openspec/changes/<change>/tasks.md of every active change, and the
 * folders of openspec/changes/archive.
 *
 * From the project root: relative paths follow the working directory, which
 * moves with every `cd` of the shell (into a module, a frontend…), and the
 * pane would empty.
 */
async function load($: EngineInterface): Promise<{ active: Change[]; archived: Change[] }> {
  const dir = `${await $.session.root()}/openspec/changes`
  let entries
  try {
    entries = await $.fs.list(dir)
  }
  catch {
    return { active: [], archived: [] }
  }
  const active: Change[] = []
  for (const entry of entries) {
    if (entry.kind !== 'dir' || entry.name === 'archive') {
      continue
    }
    const path = `${dir}/${entry.name}`
    active.push({ name: entry.name, since: await startedAt($, path, entry.mtimeMs), ...(await readTasks($, path)) })
  }
  // Oldest first.
  active.sort((a, b) => a.since - b.since || a.name.localeCompare(b.name))

  const archived: Change[] = []
  try {
    for (const entry of await $.fs.list(`${dir}/archive`)) {
      if (entry.kind === 'dir') {
        archived.push({ name: entry.name, since: entry.mtimeMs, ...(await readTasks($, `${dir}/archive/${entry.name}`)) })
      }
    }
  }
  catch {
    // No archive folder yet.
  }
  // Their names start with the date they were archived on.
  archived.sort((a, b) => a.name.localeCompare(b.name))
  return { active, archived }
}

async function refresh($: EngineInterface): Promise<void> {
  const loaded = await load($)
  await update($, changes, () => loaded.active)
  await update($, archive, () => loaded.archived)
}

/**
 * Archives a change the way the OpenSpec command does (it moves the folder to
 * archive/ under today's date and applies its spec deltas to the main specs).
 */
async function archiveChange($: EngineInterface, name: string): Promise<void> {
  const script = '[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ] && . "${NVM_DIR:-$HOME/.nvm}/nvm.sh" >/dev/null 2>&1; exec openspec archive "$1" --yes'
  try {
    const { exitCode, stdout, stderr } = await $.process.run(['bash', '-c', script, 'openspec', name], {
      cwd: await $.session.root(),
      timeoutMs: 60000,
    })
    const output = (exitCode === 0 ? stdout : stderr || stdout).trim().split('\n').filter(Boolean).slice(-2).join(' ')
    await $.ui.toast(exitCode === 0 ? `Archived ${name}.` : `Could not archive ${name}: ${output}`)
  }
  catch (error) {
    await $.ui.toast(`Could not archive ${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
  await refresh($)
}

export const register: Register = on => {
  let cancel: (() => void) | undefined

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'openspec',
      description: 'Show the tasks of the active OpenSpec changes in a side pane',
    })
    await loadStarted($)
    await refresh($)
    cancel?.()
    cancel = $.clock.every(20000, () => refresh($)).cancel
    // Panes do not survive a restart (claude --continue included): reopen it
    // when there is work to follow and it is not already up.
    const isUp = (await $.ui.panes()).some(pane => pane.id === PANE)
    if (!isUp && (await read($, changes)).length > 0) {
      await $.ui.open({ id: PANE, title: 'OpenSpec' })
    }
    return started
  })

  on('command.run', { command: 'openspec' }, async $ => {
    await loadStarted($)
    await refresh($)
    const opened = await $.ui.open({ id: PANE, title: 'OpenSpec' })
    // Say why when the surface does not draw it (narrow terminal, a surface
    // without panes such as an IDE, or none attached).
    return { text: opened.isPlaced ? 'OpenSpec pane opened.' : `OpenSpec pane not shown: ${opened.reason}` }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await refresh($)
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, changes)
    const old = await read($, archive)
    const current = await read($, tab)
    const begun = new Set(await read($, started))

    const stages: Record<Stage, Change[]> = { backlog: [], progress: [], done: [] }
    for (const change of list) {
      stages[stageOf(change, begun.has(change.name))].push(change)
    }
    const columns = [
      { id: 'backlog', label: 'Backlog', count: stages.backlog.length },
      { id: 'progress', label: 'In progress', count: stages.progress.length },
      { id: 'done', label: 'Done', count: stages.done.length },
      { id: 'archived', label: 'Archived', count: old.length },
    ] as const

    // One tab per phase, the oldest change first inside each.
    const tabs = (
      <Box flexDirection="row" marginBottom={1}>
        {columns.map(column => (
          <Box key={column.id} flexDirection="row">
            <Button
              key={`tab-${column.id}`}
              label={`${column.label} ${column.count}`}
              variant={current === column.id ? 'primary' : 'secondary'}
              onPress={() => update($, tab, () => column.id)}
            />
            <Text> </Text>
          </Box>
        ))}
      </Box>
    )

    if (current === 'archived') {
      return (
        <Box flexDirection="column">
          {tabs}
          {old.length === 0 && <Text dimColor>No archived changes.</Text>}
          {old.map(change => (
            <Text key={change.name} dimColor>
              ☑ {change.name} {change.done}/{change.total}
            </Text>
          ))}
        </Box>
      )
    }

    const shown = stages[current]
    const empty = { backlog: 'Nothing waiting to start.', progress: 'Nothing in progress.', done: 'Nothing done and waiting to be archived.' }
    // Each change is a card: its name, a progress bar and the button that moves
    // it to the next (or the previous) phase.
    const card = (change: Change, button: ReturnType<typeof Button> | undefined) => (
      <Box key={change.name} flexDirection="row">
        <Box flexShrink={1}>
          <Text bold={current !== 'done'} color={current === 'done' ? 'green' : undefined}>
            {change.name}
          </Text>
        </Box>
        <Text dimColor> {bar(change.done, change.total)} {change.done}/{change.total} </Text>
        {button}
      </Box>
    )

    return (
      <Box flexDirection="column">
        {tabs}
        {shown.length === 0 && <Text dimColor>{empty[current]}</Text>}
        {shown.map(change => {
          if (current === 'backlog') {
            return (
              <Box key={change.name} flexDirection="column" marginBottom={1}>
                {card(change, <Button key={`start-${change.name}`} label="start ▶" variant="primary" onPress={() => setStarted($, change.name, true)} />)}
                <Text dimColor> {change.total} tasks</Text>
              </Box>
            )
          }
          if (current === 'done') {
            return (
              <Box key={change.name} flexDirection="column" marginBottom={1}>
                {card(change, <Button key={`archive-${change.name}`} label="archive ▶" variant="primary" onPress={() => archiveChange($, change.name)} />)}
              </Box>
            )
          }
          const open = change.groups.filter(group => group.tasks.some(task => !task.isDone))
          const closed = change.groups.length - open.length
          return (
            <Box key={change.name} flexDirection="column" marginBottom={1}>
              {card(change, change.done === 0 ? <Button key={`back-${change.name}`} label="◀ backlog" plain dimColor onPress={() => setStarted($, change.name, false)} /> : undefined)}
              {open.map(group => (
                <Box flexDirection="column" key={`${change.name}-${group.title}`}>
                  <Text dimColor>
                    {group.title} {group.tasks.filter(task => task.isDone).length}/{group.tasks.length}
                  </Text>
                  {group.tasks.filter(task => !task.isDone).map((task, index) => (
                    // One Text: a long label wraps within the pane's width.
                    <Text key={`${group.title}-${index}`} color="yellow">
                      {' ☐ '}{task.label}
                    </Text>
                  ))}
                </Box>
              ))}
              {closed > 0 && <Text dimColor> ☑ {closed} {closed === 1 ? 'group' : 'groups'} done</Text>}
            </Box>
          )
        })}
      </Box>
    )
  })
}
