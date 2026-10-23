### Fixed

- Send Live Activity starts, completions, failures and input requests without the streamed-text delay. Coalesce bursts with a one-second minimum send interval; ordinary updates keep their push-budget spacing.
- Clarify that scheduled reminders must send the requested message in chat. Agents could previously end such a run without a message or notification.
- Relay delegated replies as natural summaries with clear attribution, instead of a name followed by a copied quote. Preserve facts, uncertainty and requested exact output.
