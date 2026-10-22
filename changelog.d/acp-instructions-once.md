### Changed

- Agents on ACP providers (such as OpenCode, Grok and custom agents) and on Muse now get their
  instructions once per session, not with each message. The instructions are 20,000 to 30,000
  characters, so each message used thousands of extra input tokens. OpenBot sends the instructions
  again when they change, such as after a new memory, after the agent compacts its context, after a
  failed message and after a restart. An agent that does not report its context size gets them
  again every 10 messages.
