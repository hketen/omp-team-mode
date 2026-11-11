# omp-team-mode

An [omp](https://omp.sh) plugin that adds an opt-in **CTO team mode**.

When CTO mode is on, the main agent becomes a CTO: it does not edit code itself. It writes a spec, sends the work to a `team-developer` subagent, has a `team-reviewer` subagent check the developer's first plan before approving it, sends the finished change to `team-reviewer` again, relays `MUST_FIX` items until the review passes, and then reports back to you in fixed sections. It prints a status line at every phase change (`▶ [n/5 Phase] ...`) in your language (the fast path prints only Spec and Report), and the footer shows `CTO` while the mode is on.

Fast path: a mechanical change with no logic (version bump, rename, typo, config value) skips plan approval and review; the CTO checks the diff itself and says so in the report.

When CTO mode is off, nothing is injected and omp behaves like the default agent.

## What's inside

| Path | Purpose |
| --- | --- |
| `src/cto.ts` | Extension: the `/cto` command, state handling, system-prompt injection, footer `CTO` indicator |
| `prompts/cto.md` | CTO rules appended to the system prompt while the mode is on |
| `agents/team-developer.md` | `team-developer` subagent: plans, waits for `APPROVED`, implements, fixes `MUST_FIX` items |
| `agents/team-reviewer.md` | `team-reviewer` subagent: read-only review of the first plan and of the change against the acceptance criteria, runs tests, reports `gaps` |

The agents are prefixed with `team-` so they do not shadow omp's bundled agents.

## Plan review, gaps and report

- **Plan review.** Before the CTO approves the developer's first plan, `team-reviewer` checks it against the code (`Mode: plan`): places the change must reach that the plan misses, steps that would break existing behavior, criteria the plan does not meet. The CTO checks revised plans itself; the fast path skips the plan review.
- **`gaps`.** The reviewer lists what the acceptance criteria do not cover but the plan or change affects (callers, untested behavior changes, data or compatibility impact). Gaps do not block; the CTO sends each one to the developer as a fix, asks you, or lists it in the report.
- **Report.** Fixed sections, in your language: what changed; how it was verified (it says so if tests were not run); decisions and assumptions made on your behalf; what was not checked; open items (`gaps`, `nice_to_have`).

## Install

In omp:

```
/marketplace add hketen/omp-team-mode
/marketplace install team-mode@omp-team-mode
```

Then restart the session (extension modules load at session start).

## Local development

```sh
git clone https://github.com/hketen/omp-team-mode
omp plugin link ./omp-team-mode    # installs it as a linked plugin
# or, for a single run without installing:
omp -e ./omp-team-mode
```

Tests (they need a Bun that has `Bun.YAML`):

```sh
bun test
```

## Commands

| Command | Effect |
| --- | --- |
| `/cto` | Show the effective state and where it comes from: `session`, `default`, or `off` |
| `/cto on` | Turn CTO mode on for the current session |
| `/cto off` | Turn CTO mode off for the current session |
| `/cto default on` | New sessions in this profile start with CTO mode on |
| `/cto default off` | New sessions in this profile start with CTO mode off |
| `/cto test none\|fast\|full` | Use this test mode for the next prompt only, then return to the default |
| `/cto default test none\|fast\|full` | Default test mode for this profile (applies at once) |

Anything else prints the usage.

## State and precedence

The effective state is resolved in this order:

1. **Session choice**: the last `/cto on` / `/cto off` on the current session branch. It is stored in the session file, so it survives resume, and branch / tree navigation restores whatever was chosen on that branch.
2. **Profile default**: set with `/cto default on|off`, stored as `team-mode.json` in the active omp profile's agent directory (for example `~/.omp/agent/` or `~/.omp/profiles/<name>/agent/`).
3. **Off.**

The profile default is read when a session opens (start, `/new`, resume). Changing it does not affect sessions that are already open.

CTO rules are injected only into the main session. Subagents, including `team-developer` and `team-reviewer`, never get them.

## Test mode

Controls how much the `team-developer` and `team-reviewer` test while CTO mode is on. The CTO passes the mode in every task. The plan review runs no tests in any mode.

| Mode | Behavior |
| --- | --- |
| `none` (default) | Tests are written, but not run. |
| `fast` | Only the tests/checks that cover the change run. |
| `full` | The full test suite and checks run. |

Example: `/cto default test full` once; for a small text change, `/cto test fast` before that prompt.

## Release

Bump `version` in both `package.json` and `.omp-plugin/marketplace.json`: upgrade only triggers on a newer version.

## License

MIT
