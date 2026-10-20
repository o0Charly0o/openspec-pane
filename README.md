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
- Each change shows its progress (`done/total`) and its task groups, with `☑`/`☐` per task, read from the `- [ ]`/`- [x]` checkboxes of its `tasks.md`.

## License

MIT, see [LICENSE](./LICENSE).
