import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Change, Group } from '../types'


const PANE = 'openspec-pane'
const changes = atom({ plugin: 'openspec-pane', key: 'changes' } as const, [])

/**
 * Reads openspec/changes/<change>/tasks.md of every active change.
 *
 * From the project root: relative paths follow the working directory, which
 * moves with every `cd` of the shell (into a module, a frontend…), and the
 * pane would empty.
 */
async function load($: EngineInterface): Promise<Change[]> {
  const dir = `${await $.session.root()}/openspec/changes`
  let entries
  try {
    entries = await $.fs.list(dir)
  }
  catch {
    return []
  }
  const found: Change[] = []
  for (const entry of entries) {
    if (entry.kind !== 'dir' || entry.name === 'archive') {
      continue
    }
    let text = ''
    try {
      text = String(await $.fs.read(`${dir}/${entry.name}/tasks.md`))
    }
    catch {
      found.push({ name: entry.name, done: 0, total: 0, groups: [] })
      continue
    }
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
    found.push({ name: entry.name, done: all.filter(t => t.isDone).length, total: all.length, groups: tracked })
  }
  return found
}

async function refresh($: EngineInterface): Promise<void> {
  const loaded = await load($)
  await update($, changes, () => loaded)
}

export const register: Register = on => {
  let cancel: (() => void) | undefined

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'openspec',
      description: 'Show the tasks of the active OpenSpec changes in a side pane',
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

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await refresh($)
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, changes)
    if (list.length === 0) {
      return <Text dimColor>No active OpenSpec changes.</Text>
    }

    return (
      <Box flexDirection="column">
        {list.map(change => (
          <Box flexDirection="column" key={change.name} marginBottom={1}>
            <Text bold color={change.done === change.total && change.total > 0 ? 'green' : undefined}>
              {change.name} {change.done}/{change.total}
            </Text>
            {change.groups.map(group => (
              <Box flexDirection="column" key={`${change.name}-${group.title}`}>
                <Text dimColor>{group.title}</Text>
                {group.tasks.map((task, index) => (
                  // Long labels wrap to the pane's width, the next rows under
                  // the label rather than under the checkbox.
                  <Box key={`${group.title}-${index}`} flexDirection="row">
                    <Text dimColor={task.isDone} color={task.isDone ? undefined : 'yellow'}>
                      {task.isDone ? ' ☑ ' : ' ☐ '}
                    </Text>
                    <Box flexShrink={1}>
                      <Text dimColor={task.isDone} color={task.isDone ? undefined : 'yellow'}>
                        {task.label}
                      </Text>
                    </Box>
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    )
  })
}
