export type Task = { label: string; isDone: boolean }
export type Group = { title: string; tasks: Task[] }

/** Which artifacts of the change exist, as OpenSpec's spec-driven schema names them. */
export type Artifacts = { proposal: boolean; specs: boolean; design: boolean; tasks: boolean }

export type Change = {
  name: string
  since: number
  /** Last modification of its tasks.md, milliseconds since the epoch; 0 without one. */
  touched: number
  schema: string
  artifacts: Artifacts
  done: number
  total: number
  groups: Group[]
}

/** The stages of an OpenSpec change: planning, apply, ready to archive, archived. */
export type Stage = 'planning' | 'apply' | 'ready' | 'archived'

/** A model turn (the main one or a subagent's) that works on a change. */
export type Running = {
  turnId: string
  /** The change the turn names; absent until one is known. */
  change?: string
  /** The task number the turn names, such as `2.8`. */
  task?: string
  since: number
}

declare module 'claude-code' {
  interface PluginState {
    'openspec-pane': { changes: Change[]; archive: Change[]; tab: Stage; running: Running[]; frame: number }
  }
}
