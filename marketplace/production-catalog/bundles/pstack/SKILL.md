---
name: pstack
description: poteto's pstack agent workflows in one skill. Rigorous playbooks, engineering principles, deliberate subagents, unslopped prose, simple code, and verified work. Use for /pstack, pstack, poteto, /poteto-mode, or a named pstack skill such as how, why, architect, interrogate, arena, swarm, tdd, unslop, blast-radius, recall, reflect, or no-comments.
disable-model-invocation: true
---

# pstack

This folder bundles the pstack plugin by Lauren Tan (MIT, see `LICENSE` and `NOTICE.md`). The files under `skills/`, `agents/`, `docs/` and `README.md` are the upstream files, unchanged.

## Route the request

- `/pstack` alone, or `/pstack <task>`: read `skills/poteto-mode/SKILL.md` in full and follow it for the task.
- `/pstack <name> <args>`, where `skills/<name>/SKILL.md` exists: read that file in full and follow it with `<args>`. `/pstack help` runs `skills/poteto-help/SKILL.md`.

## Resolve pstack names

- A skill named `<name>`, `/<name>`, or the `<name>` skill: `skills/<name>/SKILL.md`. Relative links in a file resolve from that file's folder.
- A subagent with `subagent_type: "<agent>"`: `agents/<agent>.md`. When your harness does not know that type, start a general subagent and give it the body of that file as the first part of its prompt, followed by the task.
- A script under a skill's `scripts/` folder: run it from that folder.
