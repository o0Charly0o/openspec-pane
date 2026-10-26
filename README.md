# openspec-pane

A Claude Code mod: a side pane with the tasks of the active [OpenSpec](https://github.com/Fission-AI/OpenSpec) changes of the current project, refreshed as work goes on. It opens by itself at session start when there are active changes.

It works in any project that uses OpenSpec: it reads `openspec/changes/*/tasks.md` from the project root, and needs no configuration.

## Install

At the prompt of a terminal session:

```
/plugin install openspec-pane --marketplace o0Charly0o/openspec-pane
```

From a shell:

```
claude plugin install openspec-pane --marketplace o0Charly0o/openspec-pane
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `o0Charly0o/openspec-pane`, then **Add plugin**.

## Use

- The pane opens on its own when a session starts inside a project with active OpenSpec changes (one or more folders under `openspec/changes/`, other than `archive`).
- `/openspec` opens or refreshes it by hand.
- The pane mirrors the folders of `openspec/changes/`, with one tab per phase and the number of changes in each: **Backlog**, **In progress**, **Done** and **Archived**. Inside a tab the oldest change goes first (by the `created` date of its `.openspec.yaml`, else the date of its folder). Each change is a card with a progress bar and `done/total`, read from the `- [ ]`/`- [x]` checkboxes of its `tasks.md`.
- **Backlog**: changes with no task done yet. `start ▶` moves one to In progress (kept per project in the store of the mod; `tasks.md` is not touched).
- **In progress**: changes with some task done, or started by hand. They list only the pending tasks (`☐`) of the groups that still have some, with each group's `done/total`; groups with every task done collapse to one line. A change started by hand with nothing done can go back with `◀ backlog`.
- **Done**: changes with every task done. `archive ▶` runs `openspec archive <change> --yes`, as the OpenSpec command does: the folder moves to `openspec/changes/archive/` under today's date and its spec deltas are applied to the main specs. It needs the `openspec` command (the shell's `PATH`, or nvm's).
- **Archived**: the folders of `openspec/changes/archive/`, with their progress.

## License

MIT, see [LICENSE](./LICENSE).
