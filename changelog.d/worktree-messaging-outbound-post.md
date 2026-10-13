### Added

- Agents can now post to a connected Slack, Discord or Telegram place on their own initiative, from
  any chat or routine run. Ask an agent to "post the summary to #bot-inflow", or put it in a routine
  prompt. `openbot.messaging_list_places` lists the connections and their channels, and
  `openbot.messaging_post` posts the text, redacted. Before, an agent could only answer the
  conversation that addressed it.
