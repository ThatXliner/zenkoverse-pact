# Briefing agents on this project

Agents build and review this game, mostly Claude Fable 5.2 builders and critics in the gauntlet loop (#15). These rules come from Anthropic's guide, [Prompting Claude Fable 5.2](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-2), and from what went wrong in Phase A.

## Rules for every brief

1. **Give the goal and the acceptance bar, not a numbered procedure.** Fable 5.2 follows numbered steps literally, even when a step is wrong for the situation. State the outcome, the constraints, and how "done" is checked. Leave the sequence to the agent.
2. **Builders own the code.** Include: "You are the owner and long-term maintainer of this codebase, and its design is up to you." This makes the agent consolidate duplicated code instead of piling on. Expect a larger diff, and review the diff, not the summary.
3. **Include the finishing block** (below) for every long run. Phase A ended many turns while waiting on its own capture runs.
4. **Write scoped rules with reasons, not bare "never".** Fable 5.2 treats "never" as absolute. Write "Push only the `rebuild` branch: main deploys to the live site, and the lead merges after review", not "Do NOT push to main".
5. **Name the routine actions that need no approval:** installing packages, downloading CC0 assets, running builds and the capture harness, committing and pushing the working branch, killing processes the agent started.
6. **Don't let caution accumulate.** When a directive changes, send a brief fresh agent with one consolidated brief, instead of stacking corrections on a running one. Delete notes whose reason no longer holds.
7. **Set effort per role.** Builders run at `high`, and at `xhigh` only for the hardest pieces (hands, fight direction). Critics run at `high`. Mechanical edits run at `medium`.
8. **Subagents.** The lead spawns builders and critics. A builder does not delegate: in the gauntlet loop, a separate critic is the point, and nested agents multiply cost.
9. **Ask for a self-contained final report** (reporting block below).

## Finishing block (paste into long-running briefs)

```text
# Finishing work
Please avoid stopping while you still owe work the user asked for. Be persistent and do not stop unless needed.

While status notes are welcome, as is clarifying with the user on open decisions, carry on with work that does not depend on the user's answer without unnecessary stops.

If you notice yourself inviting the user to redirect you or offering to wait, instead proceed on the next part of the task. You may meet ordinary obstacles like errors, timeouts, locked files, empty results or failing tools. Diagnose them first, and when they are not real blockers, work through them with the access you have (wait and retry, fix the request, use another tool or source) rather than stopping unnecessarily.

If someone clearly decided something is a hard blocker, such as a file marked not to be touched, access that was intentionally withheld, or a safety guardrail, leave it alone, say plainly what you found, and look for another safe way to finish the task. Stopping before the task is complete is very rarely merited, as in when the task can't move forward without user input, or where the blocker is deliberate and should not be worked past. This does not override the need for confirmation on risky or destructive actions.
```

## Reporting block

```text
# Communicating clearly
Write for an intelligent but low-context reader. The person reading has not seen your tool calls, your reasoning or the files you opened, and may be switching in from other work. Messages should generally be self-contained: the reader should understand what you mean without having to dig for other context. Put the key points in the first few sentences. Practice progressive disclosure in your sentence order, and do not use undefined references and ideas in line 1 that won't make sense until the reader reaches line 12.

Use plain words, and write in clear, understandable full sentences. Do not use a term or abbreviation that you made up during the work. Say what the thing is in a way any reader would understand. Write mostly in the style of ASD-STE100 Simplified Technical English: short sentences, one idea per sentence, active voice, and consistently using the same word for the same thing. Use a paragraph of flowing prose where ideas connect, and keep bullets for lists of separate items. Leave out unnecessary details unless the reader asks and practice concision, but do ensure that your messages have the key context. Aim to make your user-facing text as human-readable and clear as possible.
```

## Gauntlet roles

- **Builder:** owns one piece (one gauntlet issue). Gets the goal, the bar and references from the issue, the ownership sentence, the finishing block, and the files it owns. It finishes when the critic passes the piece, not when the builder thinks it is good.
- **Critic:** a fresh agent on a different model from the builder when possible. It reruns `npm run capture -- --only <piece>`, compares the frames with the issue's references, and posts concrete, checkable failures as an issue comment. It never edits code. A pass needs evidence: frame paths and what each one shows.
