# superpowers-statusbar

A Claude Code mod that shows the progress of a [superpowers](https://github.com/obra/superpowers) run: the current stage (brainstorming, plan, execution, final review, finishing), the plan's task, the implementation and review loop, and what is waiting for an answer from you.

Superpowers 7.0.0 is required: the mod recognises the scripts, the subagent dispatches and the ledger as that version writes them.

## What the mod does

- **A band above the prompt**, on one line. During execution:

  ```
  ⠋ exec SDD ▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱ 7/15 · Task 7: Ledger parser · review · fix 2/5 · 42m
  ```

  Before execution, the line gives the stage and its phase (`● brainstorming · conversation`, `● brainstorming · builder check`, `● plan · drafting`). While the run works, its mark is a spinner where the surface can animate one (terminal and desktop). When the run waits for an answer, the line becomes one highlighted block, ` WAITING · <reason> `. When the width runs short, the band drops the elapsed time first, then the task title, then the bar. Outside a superpowers run, the band shows nothing. Its colours follow your Claude Code theme.

- **A pane** in five blocks: the stages (with how long each finished one took, and the milestones of brainstorming and plan), the tasks (status, duration, fix rounds), the current task's phases one per line (passed, under way, still expected), the decisions and set-aside points taken from the ledger, and an estimate of the time left. An empty block is not shown.

- **Notifications** when the run starts waiting: plan ready and execution mode to pick, implementer blocked or the 5-fix-round breaker tripped, finishing menu. Brainstorming questions and the spec approval do not notify.

The mod follows the run from Claude Code's events: tool calls (superpowers scripts, writes of the spec and the plan, subagent dispatches) and their results, turn ends, and the skills launched through the `Skill` tool. For the phases those events do not show (conversation, drafting and review of the spec or the plan, RED/GREEN/refactor), the mod exposes a tool to the model, `report_phase`, whose description asks it to report each phase change during the `brainstorming`, `writing-plans` and `test-driven-development` skills. The mod does not change the skills' text.

Known limit: a skill launched by typing `/superpowers:…` is only seen through the `skill.prompt` hook, which the security plugin built into Claude Code bypasses for plugins installed at user level. Where that is the case, such a launch can go unnoticed; the mod catches up with the run as soon as a recognisable tool call follows (for example the `sdd-workspace` script at the start of execution).

## Installation

In a Claude Code session, at a terminal's prompt:

```
/plugin install superpowers-statusbar --marketplace AdrienGras/superpowers-statusbar
```

Answer `y` to add the marketplace, then pick the scope (user by default).

## Development

To start a session with the mod loaded from a local copy of the repository:

```
claude --plugin-dir /path/to/superpowers-statusbar
```

Checks:

```
claude plugin test .
npm run typecheck
claude plugin validate .
```

The `SP_STATUSBAR_TRACE` environment variable, when it names a file, makes the mod write one JSON line per recognised action to it.

### Tests

- `claude plugin test .`: unit tests, on synthetic runs (`tests/fixtures/`).
- `npm run contract -- <superpowers folder>`: checks that the markers the mod recognises exist in a superpowers version.
- `npm run local`: runs the real plans and ledgers dropped in `fixtures-local/` (gitignored) through the parser.
- `npm run e2e -- <superpowers folder> [sdd|direct|all]`: local e2e with a real `claude -p`. The script copies `e2e/fixture` (a small Node library and its 3-task plan) to a temporary folder and has the plan executed there in SDD mode (`subagent-driven-development`), in inline mode (`executing-plans`) or both, with the mod and the given superpowers version loaded through `--plugin-dir`. The run is isolated from your configuration (`--setting-sources project,local`): none of your hooks, installed plugins or user `CLAUDE.md`; only the mod and the tested version are loaded. The run does not get every permission: `acceptEdits` (writes in the run's folder only) and a limited tool list (reading files, skills, subagents, the mod's tool, the scripts of the tested superpowers version, `node --test`, `git`, `npm test` and removing the plan's workspace); other Bash commands are refused. This list is not a security boundary: `npm test` and `node --test` run code the model writes, and `git` can act on other repositories and run commands through aliases. It guides a cooperative model, nothing more: treat the run as unsandboxed, and only launch it on a machine where that is acceptable. The script then checks the mod's trace. Errors: the stages exec then final review, the 3 tasks done, a review of each task in SDD, a verification of each task inline, and, if the run reached finishing, its menu last. Warnings, which describe the flow the model chose and do not fail the run: no RED then GREEN inline, finishing never reached, and, in SDD, no dispatch seen at `agent.spawn` (only the `tool.call` fallback). It prints `E2E <mode>: OK` (with any warnings) or the list of problems, and copies each trace to `fixtures-local/e2e/`. The run costs tokens (model `sonnet`) and takes several minutes per mode; it needs `claude` and `jq`.

  ```
  npm run e2e -- ~/.claude/plugins/cache/superpowers-marketplace/superpowers/7.0.0 all
  ```

## `/sp-progress`

`/sp-progress` opens the pane, or closes it if it is open.

The pane also opens by itself when the plan's execution starts, but only where it sits beside the transcript (fullscreen terminal). Elsewhere, it waits for the command.

## `notifications` option

The `notifications` option (on by default) turns the mod's notifications off when disabled. It is set at installation.

Notifications go through your usual channel, the one Claude Code's `preferredNotifChannel` setting names (`/config`, **Local notifications**).

## Turning off Claude Code's generic notification

Claude Code sends its own notification when a task ends or a permission is waiting. During a run, it can double the mod's. According to Claude Code's documentation at the time of writing:

- `preferredNotifChannel` set to `"notifications_disabled"` turns off Claude Code's notifications, **but also the mod's**, which go through the same channel. If you only want to keep one of the two, keep Claude Code's and disable the mod's `notifications` option.
- The `Notification` hooks in your settings run in addition to the built-in notification, without replacing it: they cannot suppress it. They also receive the mod's notifications (`plugin_notification` field), which lets you, if you notify through your own hooks, handle the mod's and Claude Code's differently (the matcher works on the notification type, for example `idle_prompt` or `permission_prompt`).
