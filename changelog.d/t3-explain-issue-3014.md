### Changed

- Agents now follow the instruction files that you wrote, such as `CLAUDE.md` or `AGENTS.md`, when
  these files set the persona, reply length and format, delegation, or group-chat behavior. Before,
  OpenBot's built-in style guidance and your files gave the agent two rule sets for the same
  decision. The rules for tools, replies, memory, approvals, secrets and the browser do not change.
