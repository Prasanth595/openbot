# Changelog

All notable changes to the OpenBot iPhone app will be documented here. The project follows
[Semantic Versioning](https://semver.org/). Notes for the next release are in
[`changelog.d/`](changelog.d/README.md). The changes of the desktop app and the web client are in
the [root changelog](../../CHANGELOG.md).

## [Unreleased]

## [1.3.1] - In review

### Added

- The owner of a hosted server can restart it from Server settings. The app asks before the restart.
  The server stops and starts again, and the app connects again when the server is back.
- Italian interface. Choose Italiano in Settings > App language, or keep System default on an
  iPhone that uses Italian.
- Get a notification when an agent finishes, stops with an error, or needs your input, an approval,
  or a step in the browser while OpenBot is not on screen. It shows the agent name and the start of
  the reply, the question, or the action to approve, and a tap opens the chat. Apple and the OpenBot
  account service cannot read the text. An answer or an error does not come while you use the
  desktop app. While the Live Activity shows, no notification comes: the Live Activity shows the
  event, and with Play sound on it lights up the screen and plays the sound, also with notifications
  off. The server must run an OpenBot version with this change.
- Settings > Notifications now has the notification and Live Activity settings on one screen. It
  turns notifications on or off, hides the reply preview, and sets the one sound of notifications
  and the Live Activity: Play sound on or off, and the OpenBot sound of the desktop app, one of the
  four sounds of the desktop sound themes, or the iOS sound. The app plays a sound when you choose
  it. For each server you can choose all activity, only the events that need you, or nothing, and
  mute the server for a time, as in the desktop app. Server settings have the same choices.
- Sign in with your email and a one-time code, the same as on the web. You no longer need to scan a
  QR code from the desktop app. The app then shows every server that your account can use.

### Changed

- You can choose a default server. Press and hold a server and choose Make default. The default
  server stays at the top of the server list, and the app opens on the first server in the list. So
  you can start on a remote or cloud server instead of your local server. Your local server stays the
  default until you change it.

### Removed

- The app no longer shows channels, with any version of OpenBot on your computer. You cannot make a new channel, and Settings no longer has Deleted channels. Search and the routine calendar show only agents. To make agents work together, put them in one sidebar section.

### Fixed

- Signed-in devices now show a hosted server with its name, as a hosted server. Before, the list
  showed it as "Desktop".
- On Android, the app no longer closes when an agent avatar fades because its computer goes offline or comes back online.

## [1.3.0] - 2026-10-13

### Added

- Visual replies. A chart, a table, a diagram or a mockup that an agent shows as an HTML page on
  the computer appears in the phone chat as its HTML file, with the page title. The phone does not
  run the page. The page does not count as an unread message.
- Report safe categories for error alerts, chat send failures, and failed actions.
- Keep a bounded local error queue and retry on foreground or reconnection. Opt-out and account changes clear pending reports.
- Add a webhook trigger to teammate and group routines. The host makes the webhook URL and the signing secret. You see the secret one time when you create the webhook, and you can make a new one.
- Each routine shows the webhook requests that it ignored. Tap **Filter events** to limit a webhook routine to one event type and to data filters.
- Animations settings. In Settings > Animations, you can turn off all animations, as Reduce Motion
  does. You can also turn off only the zoom into a chat, the agent faces, the compact message
  field, or the reply animation. The Reduce Motion setting of the phone still applies.
- Russian interface. Choose Русский in Settings > App language, or keep System default on an iPhone
  that uses Russian.
- Add Spanish and German to the app language settings.
- Hide the "Waiting for replies" list in the queued messages sheet when every teammate replied or failed.
- Use an agent's browser from your phone. Tap the globe in the chat header to see the agent's tab
  live, or to open a new tab when the agent has none. Your finger moves the pointer from anywhere
  on the screen, as on a trackpad, and a tap clicks at the pointer. Turn off Trackpad mode in the
  ··· menu to click where you tap. One finger drags, two fingers scroll, a pinch zooms, and a tap
  with two fingers or a press and hold right-clicks. The page's menu then opens on your phone, with items
  such as Copy Link and Paste. The pointer shows the page's cursor, such as a hand on a link or a
  bar in a text field. The keyboard button types on the page, and the clipboard button copies
  selected text to your phone and pastes from it. The ? button explains each gesture.
- The arrows in the bottom bar of the browser go to the previous and the next page. Reload page is
  in the ··· menu. The tabs button shows the agent's tabs: select a tab to show it, or open a new
  tab or close the tab on screen.
- The page in the browser keeps the same size on your phone when the window of OpenBot on the
  server changes size. The server needs this version of OpenBot.
- When an agent asks you to take over its browser, the request has an Open browser button. In the
  browser, choose I'm done in the ··· menu to give control back to the agent.
- You can allow or deny an agent's approval request in the chat. The card shows the command, files or permissions, and says what each answer does on the computer. Before, the chat only showed "Waiting for your input on desktop".
- When a request is too long to show on the phone, the card lets you deny it and tells you to open OpenBot on the computer to allow it.
- Mark agents that wait for you in the agent list, with an icon for a question, an approval, or a browser takeover. A "Needs you" group shows them above the sections.
- When an agent waits for you, the compact Dynamic Island shows an amber mark on the agent's photo, and the agent's name has the agent color.
- Mark all agent chats and channels on a server as read from the home screen chat options menu. If a chat cannot be marked read, it stays unread and the app tells you.
- Agent info groups the agent settings as the desktop app does: **Brain**, **Knows**, **Does**, and **Rules**. **Rules** has **Permissions**, **Notifications**, and **Advanced**.
- **Advanced** shows the workspace folder of the agent and can start a **New chat**. A new chat shows a "New chat started" divider in the chat.
- Owners and admins can turn **Computer Use** and **Local scripts** on or off for an agent, and select what a message does while the agent works (**Queue** or **Steer**). A change made on the computer or on another device shows at once. The computer that runs the agent must have the newest OpenBot desktop version.
- Owners and admins can see and delete the **Tables** that the agents share, and **Publish** an agent as a link template. The link preview of a template that you publish from the phone shows the general OpenBot image, not an agent card.
- Support Pi and Muse agents on hosts with Team API v7.
- Add provider session settings and reset on hosts that support this feature.
- Choose which agent memories enter every prompt on updated hosts. Keep other memories saved for search, and let the agent manage the selection when needed.
- Polish interface. Choose Polski in Settings > App language, or keep System default on an iPhone
  that uses Polish.
- Write and send messages while your server is offline. Waiting messages are drawn lighter, one line under them says they send when the server is online, and you touch and hold a message to edit it or not send it. They send on their own when the server is back. The phone keeps waiting messages and their files when you close the app.
- Search finds the same kinds of results as the desktop search: agents, channels, messages, files and routines. It also finds the settings pages of the app and of the server. The filter button next to the search field shows one kind of result. Files show when the computer has the latest OpenBot.
- A search result opens what it names. A message or a file opens the chat at its message. A channel opens the channel, a routine opens its settings, and a settings result opens its page.
- Settings > Animations has "Animate search results". It turns off the blur when search results change.

### Changed

- New Claude agents use Haiku 5.5 by default.
- The screen that creates an agent now has a soft glow in the color of the agent. When you select a different color, the glow and the avatar change to the new color smoothly.
- Settings has no General page. Appearance, Animations, Language, Haptics, Live Activities and
  Privacy each have their own page. Hidden chats and deleted channels are on the Settings page.
- Show what a hosted server gives at the top of the plans sheet: it runs OpenBot 24/7 on an external
  server, keeps agents and routines running when the computer is off, and needs no technical setup.
- Like on desktop, consecutive messages between agents show as one line in the chat, such as "3 messages with 2 agents". Tap it to see each message.
- A message to several agents shows their avatars and the number of agents. Tap it to see their names.
- Explain that Local scripts can also send messages, answer questions, and accept or decline approvals on a supported host.
- Show a specific reason when a connection to a server fails, for example when the host is busy or
  an invitation was already used. Before, most of these failures showed "The connection failed."
- Show a short error code in error alerts, with a "Copy code" button. Send this code when you report
  a problem, so we can find the cause.
- German, Spanish, French, Japanese, Russian and Turkish now translate all screens of the app.
- The app no longer sells cloud servers. Tap + in the server list to see the plans and your cloud servers, with the plan, billing period and state of each server.
- When an agent asks for a password or a code, you type it where the composer is. The value goes only to the browser, not to the chat.
- Browser takeover requests in a chat show as a lighter card, with one main action and a close button to cancel.
- While an agent waits for you in its browser, the chat says so, instead of asking for input on the desktop.
- The chat stays free while a message sends: you can write and send the next one at once. Messages of one chat arrive in the order you sent them.
- A message that did not send stays in the chat as `Not sent`. Touch and hold it to retry, edit it or not send it. Before, its text went back to the composer.
- When the connection drops during a send, the message waits and sends again when the server is back, and the server stores it once. A server that cannot recognize a repeated message marks it `Not confirmed` instead, so you can check the chat first.
- Search results show the agent or channel picture, the time and the words that match. All shows the first results of each kind, and "See all" shows all results of that kind.
- Search results come in, go out and move to their new place with a short animation. Sections of results and search messages come in with a short blur. When motion is reduced, they only fade.

### Fixed

- Voice mode on iOS. The Cancel and Send buttons no longer show as small circles behind the voice
  button while you speak, or behind the composer after the voice mode closes.
- Show the answers that an agent waits for, and the latest channel message, as plain text. Before,
  these previews showed raw Markdown marks such as `**` and `#`.
- A message that you send to a running turn now shows after what the agent did before it. Before, it moved up to the turn's first message.
- Prevent a server connection from closing with “Signal message is invalid” when the browser sends an empty ICE completion marker.
- Keep the connection to your computer when you open the app again while the connection still
  works. Before, each return to the app restarted the connection path, and after 10 restarts the
  computer closed the connection. The app then stopped for a few seconds while it connected again.
- The agent's browser follows the light or dark appearance of the app.
- Live Activity answer buttons show as one capsule each and share the full width.
- The owner of a server can now remove it from the account in server settings, also when its computer is offline or gone. Before, an owner could not remove such a server. The removal applies to all members and all devices. Members lose access, and connected Slack, Discord, Telegram and webhook routes stop. If you add the server again, invite its members again and set up its connections again. Old webhook URLs do not work again.
- Open a chat of an agent on a connected server that is not the active one, for example from a Live Activity, and OpenBot now loads the messages, loads older messages and marks them read on the agent's own server. Before, it asked the active server.
- Report failed browser Live View connections and input as failures instead of normal view termination. Release failed sessions so the view can be opened again.
- Tasks card. The step in progress shows all its lines at each text size. Before, a larger text
  size cut off the bottom of the step, and the next step touched it.
- While an agent works, its activity row in the chat now shows at most two lines of its thinking text, next to the avatar, as on desktop. Before, a long thinking step made the row as tall as all of its text, and most of that text did not show, so the chat showed a large empty space with the avatar in the middle of it.
- The activity row now stays from when you send a message until the reply shows. Before, on Android, the row could disappear and show again while the agent started its work.
- On Android, the activity row no longer shows a black background for a moment when it appears.
- On Android, the bubble of an agent reply now grows with its text. Before, the text could go out of the bubble while the reply showed.
- On Android, the text of a reply no longer flickers while it shows word by word. Each word now shows at once.
- A browser request in a chat stays visible, with the typed value, while Notification Center or another system overlay is open.
- In Settings > Support, the recent log scrolls in its own box, so a long log does not make the page very long.
- After 45 minutes on one server connection, and on each return to the app after that, the app asked the signalling service for new relay credentials many times a second, until the service closed the socket for a minute. A lost connection could not recover in that minute. The app now asks once every 45 minutes.
- A remote connection that Signal refuses for a reason other than a rate limit, such as an invalid ticket, reconnects at once. Before, OpenBot waited 60 seconds as if Signal had limited its rate.
- A server is usable sooner after you return to the app. Before, "Reconnecting" stayed until every chat that you had opened before had loaded again, one after another. Now it ends when the agents and the unread counts load, and the chats load after it, the open chat first.
- After more than 30 seconds away, the app waited 3 seconds for a dead connection before it connected again. Now it repairs the connection at once, or replaces it at once when the server has already dropped it. After more than about 3 minutes away, it shows at once that it connects, instead of a server that looked online but did not answer.
- On a return to the app, the selected server connects first, and your other servers follow when it is online.
- When the server had dropped the connection while the app was in the background, the status showed a short countdown and said that the desktop had restarted. Now it shows that the app connects again, and the message says that the server no longer has the connection.

## [1.2.0] - 2026-10-08

### Added

- In an agent chat on a team, each message from another person stands on the right, with your messages, and shows their name. Their bubble has their own color, so it does not look like yours. Messages sent before this update show as yours.
- Turkish (`tr`) language support in mobile app settings and interfaces.
- Brazilian Portuguese for the iPhone app. Select Português (Brasil) in Settings, or use your phone language.
- More of the iPhone app is in Turkish, including agents, chats, channels, servers and usage.
- Routines for a server. Touch and hold a server in the server list, then select Routines. The week view shows the runs of each day with the agents that do them. Swipe the days to change the week. Select Day in the header to see one day; today also shows the next runs. Select a run to open its routine.
- Buy a cloud server from the iPhone app. Tap + in the server list, choose a plan, and pay on a secure Stripe page. The app shows the setup until the server is ready, and the server shows on your computer too.
- Usage for a server. Touch and hold a server in the server list, then select Usage. The report shows the processed tokens and the estimated cost of all agents on the server, with the share of each agent. Select an agent in the list, or in the Agent row at the top, to see the usage of one agent.
- Settings → Support. It shows how to get help: report a problem on GitHub or message us on X. It also shows a support log of recent app events, connection steps, requests and errors. Select Save log file to save the log or attach it to a message. The log stays on your phone and OpenBot never sends it. It does not record messages or files, and it masks passwords and tokens. Select Clear log to remove it.
- Cursor and Cline agents on a server now show in the app. Before, the server kept them hidden.
- HTML pages and Mermaid diagrams in a reply. A code block marked `html` or `mermaid` shows as a
  card with a header and a small picture of the page or the diagram. Tap the card to open it on its
  own screen. Go back with the back button or a swipe from the left edge. Use the menu in the
  top-right corner to switch between Preview and Code, to wrap long lines of code, or to copy the
  code. Move a diagram with one finger, pinch to zoom, and double-tap to zoom in or to see the
  whole diagram. A page runs no scripts and loads nothing from the network.
- Buy a cloud server from the Android app, version 1.1.0. Tap + in the server list and choose a plan.

### Changed

- A routine run in a chat shows as one short line with the routine name and its state. The chat no
  longer shows the routine instruction as your message.
- The routine schedule is easier to set. Select how often it repeats (hourly, daily, weekly, monthly or yearly), then the days and the time, as on desktop. A cron expression is now the last choice, for advanced schedules only.
- The OpenBot logo no longer turns when you turn your phone, and the app no longer uses motion access.
- Settings → About shows the build number after the version, such as "1.1.0 (17)".
- The agent Usage page has a clearer period control. Select 7 days, 30 days, 90 days, 1 year or Custom. For Custom, set the start and end dates with the date pickers. The report changes at once. The daily chart is now the chart of the desktop app: one area for each provider, in its color, with the values on a grid. Touch or drag across the chart to see a day, with the value of each provider under it. When you change the period or the agent, the report stays on screen and its numbers and chart move to the new values.
- On Android, the app no longer asks for access to all photos and videos. You still choose photos and files with the system picker, and you can still save images from a chat.
- The microphone in a chat now opens a voice mode. The composer becomes one round button in the
  centre, the chat goes darker with a blur from the edges, and a glow in the agent's colours follows
  your voice. Your words come in one by one at the top of the screen. Press the button to stop, then
  choose Cancel, Continue or Send. Before, dictation put the words into the message field.
- On Android, sheets have rounded top corners, as on iPhone.
- On Android, content in a sheet fades below the header and does not stop at a hard line.
- A server with no agents shows animated characters around an Add agent button in the center of the screen. Before, it showed a small icon and a plain button.

### Fixed

- Opening a chat with unread messages marks them read. Before, the unread dot stayed until you
  scrolled to the bottom when the chat opened in the middle of its history.
- Keep the connection to your desktop when the phone changes between Wi-Fi and mobile data, or
  loses mobile data for a short time. Before, the app made a new connection after 5 seconds,
  waited 10 seconds between attempts, and waited 2 minutes after 5 failed attempts.
- Reconnect as soon as the phone gets a network again, not at the next planned attempt.
- Keep a new connection over a slow mobile network. Before, the first check of the desktop stopped
  after 3 seconds and started the connection again.
- The iPhone app now shows the year on a date that is not from the current year. Before, a message from last year and one from this month could show the same day and month, and the list could not be read by recency.
- The app no longer stops at start with "Cannot find native module 'ExpoWidgets'" in a build without Live Activities. It opens without them.
- When you ask an agent to create a routine from the iPhone app, the routine now runs in the
  phone's timezone. Before, it ran in the server's timezone. The server must be updated too.
- A long press on a server in the server list keeps the list open while the menu shows.
- On Android, the areas behind the status bar and the navigation bar now use the app background color, not a light color.
- On Android, sheets now show their Save, Close, Add and Copy buttons.
- On Android, sheet headers no longer have extra space above the title.
- On Android, a downward drag in a sheet scrolls the list before it closes the sheet.
- On Android, a long press on an agent shows all of the agent actions, as on iPhone.
- On Android, the agent search has one background color.
- On Android, choices such as Theme, Language, routine Repeat and Day, model, access and member role open a menu, and the switches in Settings → General are easier to read.
- On Android, the home header has the same color as the list.
- On Android, the app now fills the screen from the top edge to the bottom edge, behind the status bar and the navigation bar.
- On Android, a long press on a server in the server list opens its options.
- On Android, a downward drag on a short list in a sheet, such as the search results, closes the sheet.
- On Android, the loading animation no longer stays over the app after loading ends.
- On Android, the header over the invitation scanner in the Cloud server sheet is transparent, as on iPhone.
- On Android, the name of a pinned agent or channel is cut to its column.
- On Android, the agent search keeps the results below the search field when the keyboard opens.
- On Android, the keyboard opens when the New section sheet opens.
- On Android, a file that the app cannot read with the file API can still be attached to a message.
- On Android, the agent choice on the server Usage screen opens a menu, as the other choices in the app do.
- On Android, pinned agents and channels with a long title took too much space, and their titles were not shortened. Each pinned item now stays in its column.
- On Android, the numbers in the "Reconnecting" status flickered when they changed. They now fade smoothly from one value to the next.
- The "Reconnecting" countdown showed 0:00 at the start of each attempt and then jumped to the wait. It now shows the wait from the start of the attempt, and it appears together with the status.
- Android sheets no longer show a blur at the top edge. All sheets now look the same.
- The server Usage sheet on Android no longer has extra empty space above its title.
- On Android, the sheet that adds a shared agent from a link shows its title, Close and Add agent buttons.
- On Android, the Create an agent, New channel, New section and Actions needed sheets show their title, Close and Create or Save buttons.
- On Android, the app no longer closes with an error when you save in a sheet.
- On Android, agent and channel rows in the home list were wider than the screen. Long text was not shortened, and the time of the last message was not aligned or not visible. Each row now fits the screen.
- On iPhone, the home screen of a server with no agents does not scroll. Before, you could drag it up and down.
- The home list now blurs below the header when you scroll, as the chat does, on iOS and Android.
- On Android, the home header is no longer an opaque bar that cuts the top row of the list.

## [1.1.0] - 2026-09-29

### Added

- Choose the app language in Settings > General: System default, English, French or Japanese. Text
  that has no French or Japanese translation yet shows in English.
- Search agents and the messages in their chats on the connected computer. Search and add are two
  separate buttons on the home screen.
- An agent plan shows as a task list, as on desktop: a card that opens and closes, with the state of
  each step and a spinner on the step that runs.
- A file name in inline code, such as `package.json`, shows a type badge and the color of its file
  type, as on desktop.
- A failed message shows the reason below it. When the computer gives no clear reason, the app
  tells you to send the message again.
- Owners and admins can set the access of an agent (Workspace only or Full access) and Auto approve
  on the Runtime page of the agent. Full access asks for confirmation first.
- Owners and admins can change the server name and logo in Server options. The server list shows the
  logo.
- Haptic feedback when you open and close screens, pick options, save, and when an action succeeds
  or fails. Turn it off with the Haptics setting.
- Open a shared agent link (`https://openbot.run/agents/...` or `openbot://agents/...`) in the app.
  You see the agent before you add it, and you choose the server where you are owner or admin.
  Before, the link opened Safari or showed "Link unavailable".
- Manage the skills of an agent from Agent info > Skills. An owner or admin can turn a skill on or
  off and uninstall it. A folder skill stays read-only, and a member sees only the list.
- Create a skill from Agent info > Skills. An owner or admin taps +, and the app puts the request
  in the agent chat. The agent then asks what the skill is for.
- The skill list updates by itself when a skill changes on the computer or on another device. The
  computer must run a version that sends these updates.
- Chat messages show LaTeX math as formulas. Write inline math as `$...$` or `\(...\)`, and display
  math as `$$...$$`, `\[...\]` or a `math` code block. A formula that does not parse shows its
  source.
- Turn off the agent color on your messages in Settings > General > Appearance. Your messages then
  use the neutral color. The setting is on by default.
- The message box continues a Markdown list. Press Return after a `- `, `* ` or `1. ` item to start the next item. Press Return on an empty item to end the list.
- When you open a hosted server that stopped after it was not in use, the app starts it again and connects when it is ready.
- The Lock Screen and the Dynamic Island show what your agents do, as the desktop Dynamic Island
  does: work, new replies, questions, approvals, browser steps, and failed tasks. You can answer an
  approval or a short question from the Lock Screen. OpenBot asks again before it approves a command.
  When several agents have new replies, the activity lists them. Settings > General > Live Activities
  turns this off. When iOS stops OpenBot in the background, the host keeps the activity current
  through Apple. The update is encrypted for your phone, so Apple and OpenBot cannot read it.

### Changed

- The question form of an agent has no text field of its own. Tap "Reply in the chat", and your next
  message from the composer is the answer. A private answer still uses its own masked field.
- An answer from a teammate agent shows under "Waiting for replies" in the queue sheet, and not as a
  queued message that you can edit, steer or move. The computer must run a version that sends this
  information.
- Server members shows how many members the server has of its limit, for example "1 of 3 members".
  When the server is full, you cannot create an invitation until you remove a member.

### Fixed

- The highlight of the selected server fills the full row in the server list. Before, it stopped at
  the end of the server name.
- Search shows only results from your computer. Before, it showed sample English results.
- Chat previews and search results show message text without Markdown marks such as `**`.
- The keyboard closes when you leave a chat with the back button or a swipe. Before, the keyboard
  stayed open over the agent list, and you could not close it.
- Long inline code in a chat message breaks across lines. Before, the code wrapped inside its box
  and covered the line above.

## [1.0.0] - 2026-09-28

### Added

- First mobile release.
