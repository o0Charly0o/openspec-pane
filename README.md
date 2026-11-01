# openspec-pane

A Claude Code mod: a side pane that follows the [OpenSpec](https://github.com/Fission-AI/OpenSpec) changes of the current project through the stages OpenSpec itself defines. It opens by itself at session start when there are active changes, and refreshes as work goes on.

It works in any project that uses OpenSpec and needs no configuration. It adds no states of its own: everything it shows comes from the files of `openspec/`, and the only way it moves a change on is by running the slash command of OpenSpec for that stage.

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

Developed against Claude Code 2.1.302 and OpenSpec 1.14.1.

## Use

`/openspec` opens or refreshes the pane. It has one tab per stage of the OpenSpec flow, with the number of changes in each. Inside a tab the oldest change goes first (by the `created` date of its `.openspec.yaml`, else the date of its folder). Each change is a card with a progress bar and `done/total`, read from the `- [ ]`/`- [x]` checkboxes of its `tasks.md`.

| Tab | Which changes | Button |
|---|---|---|
| **Planning** | Some artifact of the `spec-driven` schema is missing (`proposal`, `specs`, `design`, `tasks`). The card shows which ones exist. | `continue ▶` runs `/opsx:propose <change>` |
| **Apply** | Every artifact exists and some task is pending. It lists the pending tasks of the groups that still have some. | `apply ▶` runs `/opsx:apply <change>` |
| **Ready** | Every task is done. | `archive ▶` runs `/opsx:archive <change>` |
| **Archived** | The folders of `openspec/changes/archive/`. | none |

The buttons never change a file themselves. A change moves from one tab to the next when OpenSpec has changed its files and the pane reads them again (every 20 seconds and after every turn). If the session has no `/opsx:…` command, the button looks for the skill of the same name (`/openspec-propose`, `/openspec-apply-change`, `/openspec-archive-change`) and, if there is none either, says so: run `openspec update` in the project to create them.

A change that follows another schema than `spec-driven` is staged by its tasks only.

### What is running

While an agent works on a change, its card turns green with a spinner and the time it has been running, and the task it is on is marked `▶` in green. The pane knows it from the model turns of the session, the main one and each subagent's: a turn that names a change (and, optionally, a task number such as `2.8`) is working on it. With no task number, it is the first pending task, which is the order OpenSpec applies them in. A turn that names no change is attached to the change whose `tasks.md` was written after the turn began. The mark goes away when the turn ends. Only the change name and the task number are kept in memory, never the text of the prompts.

## What it reads, runs and sends

- **Reads** `openspec/changes/**` of the project root: `.openspec.yaml`, `proposal.md`, `design.md`, `tasks.md`, the `specs/` folder (only whether it holds a `spec.md`) and the names of the folders in `archive/`. Nothing else, and never the conversation, the environment variables or the settings.
- **Runs** one thing: the slash command of OpenSpec behind a button, as if you had typed it, once you press that button. It starts no program and no shell.
- **Sends** nothing: no network request and no data leaves your machine.
- **Stores** nothing between sessions.

## Examples

1. Open a project with OpenSpec changes: the pane opens by itself. Press `/openspec` to open it again.
2. A change with only a `tasks.md` shows under **Planning** with `proposal ○ · specs ○ · design ○ · tasks ✓`. Press `continue ▶` to run `/opsx:propose` for it.
3. Press `apply ▶` on a change: Claude applies its tasks, the first pending one shows green with a spinner, and when every task is done the change moves to **Ready**, where `archive ▶` runs `/opsx:archive`.

## Support

Report a problem, or a security concern, at <https://github.com/o0Charly0o/openspec-pane/issues>.

## License

MIT, see [LICENSE](./LICENSE).
