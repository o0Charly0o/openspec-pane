export type Task = { label: string; isDone: boolean }
export type Group = { title: string; tasks: Task[] }
export type Change = { name: string; since: number; done: number; total: number; groups: Group[] }

declare module 'claude-code' {
  interface PluginState {
    'openspec-pane': { changes: Change[]; archive: Change[]; tab: 'backlog' | 'progress' | 'done' | 'archived'; started: string[] }
  }
}
