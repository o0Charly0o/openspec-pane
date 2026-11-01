import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Artifacts, Change, Group, Running, Stage, Task } from '../types'


const PANE = 'openspec-pane'
const changes = atom({ plugin: 'openspec-pane', key: 'changes' } as const, [])
const archive = atom({ plugin: 'openspec-pane', key: 'archive' } as const, [])
const tab = atom({ plugin: 'openspec-pane', key: 'tab' } as const, 'apply')
const running = atom({ plugin: 'openspec-pane', key: 'running' } as const, [])
const frame = atom({ plugin: 'openspec-pane', key: 'frame' } as const, 0)

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SPINNER_MS = 200
// A turn that never reports its end stops showing as running after this long.
const STALE_MS = 60 * 60 * 1000

/**
 * The slash command of OpenSpec each button runs, the first one this session
 * has: the command files of `openspec init` (`/opsx:…`), else its skills.
 */
const COMMANDS: Record<Exclude<Stage, 'archived'>, { label: string; names: string[] }> = {
  planning: { label: 'continue ▶', names: ['opsx:propose', 'openspec-propose'] },
  apply: { label: 'apply ▶', names: ['opsx:apply', 'openspec-apply-change'] },
  ready: { label: 'archive ▶', names: ['opsx:archive', 'openspec-archive-change'] },
}

/**
 * The stage of an active change, as OpenSpec's own states give it: every task
 * done is ready to archive; a missing artifact (proposal, specs, design, tasks)
 * is still planning; the rest is being applied.
 */
function stageOf(change: Change): Exclude<Stage, 'archived'> {
  if (change.total > 0 && change.done === change.total) {
    return 'ready'
  }
  const a = change.artifacts
  return a.proposal && a.specs && a.design && a.tasks ? 'apply' : 'planning'
}

/** `███░░░░░░░` for 3 of 10. */
function bar(done: number, total: number): string {
  const filled = total > 0 ? Math.round((done / total) * 10) : 0
  return '█'.repeat(filled) + '░'.repeat(10 - filled)
}

/** `2m 14s`, `45s`. */
function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  return minutes > 0 ? `${minutes}m ${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`
}

/** Whether the text names the change (not as part of a longer name). */
function mentions(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\w-])${escaped}($|[^\\w-])`).test(text)
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

async function readTasks($: EngineInterface, path: string): Promise<Pick<Change, 'done' | 'total' | 'groups'> & { has: boolean }> {
  try {
    return { ...parse(String(await $.fs.read(`${path}/tasks.md`))), has: true }
  }
  catch {
    return { done: 0, total: 0, groups: [], has: false }
  }
}

/**
 * When a change was started (the `created` date of its .openspec.yaml, else the
 * time its folder last changed) and the schema it follows.
 */
async function readMeta($: EngineInterface, path: string, fallback: number): Promise<{ since: number; schema: string }> {
  try {
    const text = String(await $.fs.read(`${path}/.openspec.yaml`))
    const created = text.match(/^created:\s*(\d{4}-\d{2}-\d{2})/m)?.[1]
    const time = created ? Date.parse(created) : Number.NaN
    return { since: Number.isNaN(time) ? fallback : time, schema: text.match(/^schema:\s*(\S+)/m)?.[1] ?? 'spec-driven' }
  }
  catch {
    return { since: fallback, schema: 'spec-driven' }
  }
}

/** Whether a folder holds a spec.md, at the depth OpenSpec nests capabilities. */
async function hasSpecs($: EngineInterface, dir: string, depth = 0): Promise<boolean> {
  if (depth > 2) {
    return false
  }
  let entries
  try {
    entries = await $.fs.list(dir)
  }
  catch {
    return false
  }
  for (const entry of entries) {
    if (entry.kind !== 'dir' && entry.name === 'spec.md') {
      return true
    }
    if (entry.kind === 'dir' && (await hasSpecs($, `${dir}/${entry.name}`, depth + 1))) {
      return true
    }
  }
  return false
}

/** Which of the four artifacts of the spec-driven schema exist. */
async function readArtifacts($: EngineInterface, path: string, hasTasks: boolean): Promise<Artifacts> {
  return {
    proposal: await $.fs.exists(`${path}/proposal.md`),
    specs: await hasSpecs($, `${path}/specs`),
    design: await $.fs.exists(`${path}/design.md`),
    tasks: hasTasks,
  }
}

async function readChange($: EngineInterface, path: string, name: string, fallback: number): Promise<Change> {
  const tasks = await readTasks($, path)
  const meta = await readMeta($, path, fallback)
  let touched = 0
  try {
    touched = (await $.fs.stat(`${path}/tasks.md`)).mtimeMs
  }
  catch {
    // No tasks.md yet.
  }
  // Other schemas have other artifacts: those changes are staged by their tasks.
  const artifacts = meta.schema === 'spec-driven' ? await readArtifacts($, path, tasks.has) : { proposal: true, specs: true, design: true, tasks: true }
  return { name, since: meta.since, touched, schema: meta.schema, artifacts, done: tasks.done, total: tasks.total, groups: tasks.groups }
}

/**
 * Reads openspec/changes/<change> of every active change, and the folders of
 * openspec/changes/archive.
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
    active.push(await readChange($, `${dir}/${entry.name}`, entry.name, entry.mtimeMs))
  }
  // Oldest first.
  active.sort((a, b) => a.since - b.since || a.name.localeCompare(b.name))

  const archived: Change[] = []
  try {
    for (const entry of await $.fs.list(`${dir}/archive`)) {
      if (entry.kind === 'dir') {
        const tasks = await readTasks($, `${dir}/archive/${entry.name}`)
        archived.push({
          name: entry.name,
          since: entry.mtimeMs,
          touched: 0,
          schema: 'spec-driven',
          artifacts: { proposal: true, specs: true, design: true, tasks: true },
          done: tasks.done,
          total: tasks.total,
          groups: tasks.groups,
        })
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

/**
 * Runs the slash command of OpenSpec that moves a change on, as if the person
 * typed it. The pane only follows what the files then say.
 */
async function runCommand($: EngineInterface, stage: Exclude<Stage, 'archived'>, name: string): Promise<void> {
  const wanted = COMMANDS[stage].names
  try {
    const available = new Set((await $.command.list()).map(command => command.name))
    const command = wanted.find(one => available.has(one))
    if (command === undefined) {
      await $.ui.toast(`This session has no /${wanted[0]} command: run \`openspec update\` in the project.`)
      return
    }
    await $.ui.toast(`/${command} ${name}`)
    await $.command.run({ command, args: name })
  }
  catch (error) {
    await $.ui.toast(`Could not run /${wanted[0]} ${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * The pending tasks a running turn is on: the one it names (`2.8`), else the
 * first pending task, which is the order OpenSpec applies them in.
 */
function activeTasks(change: Change, turns: Running[]): Set<Task> {
  const pending = change.groups.flatMap(group => group.tasks.filter(task => !task.isDone))
  const active = new Set<Task>()
  for (const turn of turns) {
    const named = turn.task === undefined ? undefined : pending.find(task => task.label === turn.task || task.label.startsWith(`${turn.task} `))
    const task = named ?? pending[0]
    if (task) {
      active.add(task)
    }
  }
  return active
}

let stopSpinner: (() => void) | undefined

/**
 * Settles which turns show as running: drops the stale ones, gives a turn that
 * named no change the one whose tasks.md was written since it began, and runs
 * the spinner only while something shows.
 */
async function settle($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const list = await read($, changes)
  await update($, running, turns => turns
    .filter(turn => now - turn.since < STALE_MS)
    .map(turn => {
      if (turn.change !== undefined) {
        return turn
      }
      const touched = list
        .filter(change => stageOf(change) === 'apply' && change.touched >= turn.since)
        .sort((a, b) => b.touched - a.touched)[0]
      return touched ? { ...turn, change: touched.name } : turn
    }))
  const names = new Set(list.map(change => change.name))
  const isShown = (await read($, running)).some(turn => turn.change !== undefined && names.has(turn.change))
  if (isShown && stopSpinner === undefined) {
    stopSpinner = $.clock.every(SPINNER_MS, () => update($, frame, n => (n + 1) % SPINNER.length)).cancel
  }
  else if (!isShown && stopSpinner !== undefined) {
    stopSpinner()
    stopSpinner = undefined
  }
}

async function refresh($: EngineInterface): Promise<void> {
  const loaded = await load($)
  await update($, changes, () => loaded.active)
  await update($, archive, () => loaded.archived)
  await settle($)
}

export const register: Register = on => {
  let cancel: (() => void) | undefined

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'openspec',
      description: 'Show the stages of the active OpenSpec changes in a side pane',
    })
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
    await refresh($)
    const opened = await $.ui.open({ id: PANE, title: 'OpenSpec' })
    // Say why when the surface does not draw it (narrow terminal, a surface
    // without panes such as an IDE, or none attached).
    return { text: opened.isPlaced ? 'OpenSpec pane opened.' : `OpenSpec pane not shown: ${opened.reason}` }
  })

  // A turn that names a change is working on it: the main loop's or a
  // subagent's. Only the change and the task number are kept, never the text.
  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    const now = await $.clock.now()
    const list = await read($, changes)
    const named = [...list].sort((a, b) => b.name.length - a.name.length).find(change => mentions(e.text, change.name))
    const task = named ? e.text.match(/(?:^|[^\w.])(\d+(?:\.\d+)+)(?![\w.])/)?.[1] : undefined
    const turn: Running = {
      turnId: e.turnId,
      since: now,
      ...(named ? { change: named.name } : {}),
      ...(task ? { task } : {}),
    }
    await update($, running, turns => [...turns.filter(one => one.turnId !== e.turnId), turn])
    await settle($)
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await update($, running, turns => turns.filter(turn => turn.turnId !== e.turnId))
    await refresh($)
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, changes)
    const old = await read($, archive)
    const current = await read($, tab)
    const turns = await read($, running)
    const spin = SPINNER[await read($, frame)] ?? SPINNER[0]
    const now = await $.clock.now()

    const stages: Record<Exclude<Stage, 'archived'>, Change[]> = { planning: [], apply: [], ready: [] }
    for (const change of list) {
      stages[stageOf(change)].push(change)
    }
    const columns = [
      { id: 'planning', label: 'Planning', count: stages.planning.length },
      { id: 'apply', label: 'Apply', count: stages.apply.length },
      { id: 'ready', label: 'Ready', count: stages.ready.length },
      { id: 'archived', label: 'Archived', count: old.length },
    ] as const

    // One tab per stage of OpenSpec's flow, the oldest change first inside each.
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
    const empty = { planning: 'Nothing being planned.', apply: 'Nothing to apply.', ready: 'Nothing ready to archive.' }
    const artifactMarks = (a: Artifacts) =>
      (['proposal', 'specs', 'design', 'tasks'] as const).map(name => `${name} ${a[name] ? '✓' : '○'}`).join(' · ')

    return (
      <Box flexDirection="column">
        {tabs}
        {shown.length === 0 && <Text dimColor>{empty[current]}</Text>}
        {shown.map(change => {
          const working = turns.filter(turn => turn.change === change.name)
          const first = working.length > 0 ? Math.min(...working.map(turn => turn.since)) : now
          const open = change.groups.filter(group => group.tasks.some(task => !task.isDone))
          const closed = change.groups.length - open.length
          const doing = activeTasks(change, working)
          // Each change is a card: its name, a progress bar, the button that
          // runs the next command of OpenSpec and, while an agent works on it,
          // the green spinner with the time it has been running.
          return (
            <Box key={change.name} flexDirection="column" marginBottom={1}>
              <Box flexDirection="row">
                <Box flexShrink={1}>
                  <Text bold color={working.length > 0 ? 'green' : undefined}>
                    {working.length > 0 ? `${spin} ` : ''}{change.name}
                  </Text>
                </Box>
                <Text dimColor> {bar(change.done, change.total)} {change.done}/{change.total} </Text>
                <Button
                  key={`${current}-${change.name}`}
                  label={COMMANDS[current].label}
                  variant="primary"
                  onPress={() => runCommand($, current, change.name)}
                />
              </Box>
              {working.length > 0 && <Text color="green"> running {elapsed(now - first)}</Text>}
              {change.schema !== 'spec-driven' && <Text dimColor> schema {change.schema}: staged by its tasks</Text>}
              {current === 'planning' && <Text dimColor> {artifactMarks(change.artifacts)}</Text>}
              {current === 'apply' && open.map(group => (
                <Box flexDirection="column" key={`${change.name}-${group.title}`}>
                  <Text dimColor>
                    {group.title} {group.tasks.filter(task => task.isDone).length}/{group.tasks.length}
                  </Text>
                  {group.tasks.filter(task => !task.isDone).map((task, index) => (
                    // One Text: a long label wraps within the pane's width.
                    doing.has(task)
                      ? <Text key={`${group.title}-${index}`} color="green" bold>{` ${spin} ▶ `}{task.label}</Text>
                      : <Text key={`${group.title}-${index}`} color="yellow">{' ☐ '}{task.label}</Text>
                  ))}
                </Box>
              ))}
              {current === 'apply' && closed > 0 && <Text dimColor> ☑ {closed} {closed === 1 ? 'group' : 'groups'} done</Text>}
            </Box>
          )
        })}
      </Box>
    )
  })
}
