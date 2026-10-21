### Added

- Import your Hermes Agent profiles in Server settings › Import. Each profile becomes an agent with its persona, memories, skills and scheduled jobs. There are three ways, as for Grok Bot:
  - **Read this computer:** OpenBot reads the Hermes folder and shows every item, and why an item stays in Hermes, before anything changes. Skills with scripts and MCP servers import only when you allow them, and MCP servers are added turned off. When you import a profile again, its agent is updated, and no second agent is added.
  - **Install with a command:** type the `/skills install` command in a Hermes chat, send `/openbot-export`, and choose the `.zip` file that Hermes saves.
  - **Set it up yourself:** add the export skill file to Hermes by hand, then do the same steps.
- Keys in `.env` and `auth.json` are never copied.
- Server settings › Import now starts with where your agents are now: Hermes Agent, Grok Bot, or another OpenBot computer.
