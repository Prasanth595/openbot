import { OPENBOT_LINKS } from "../../lib/landing-links";
import type { Comparison } from "./comparison";

// Every statement about Paperclip here is taken from paperclip.ing, its documentation, or
// its repository (the README, the deployment and Tailscale guides, and the telemetry
// config and rules in packages/shared), and each page used is in `sources`. Paperclip lists no app
// for iPhone or Android and no price for Paperclip Cloud, so the text says so. Check them
// again, and move `checkedAt`, whenever this file changes.

const PAPERCLIP_REPO = "https://github.com/paperclipai/paperclip";
const PAPERCLIP_DOCS = "https://docs.paperclip.ing";

export const PAPERCLIP_COMPARISON: Comparison = {
  rival: { name: "Paperclip", mark: "paperclip" },
  answer:
    "Choose OpenBot if you want an app that you download and open, agents that you chat with as a team, and iPhone and Android apps that reach them from anywhere with no VPN: the app is free. Choose Paperclip if you want to run agents as a company, with an org chart, goals, budgets and approval stages, on a Node.js server that you set up, under the MIT license.",
  chooseOpenBot: [
    "You want a desktop app for macOS, Windows or Linux, with no server, Node.js or database to set up.",
    "You want iPhone and Android apps that reach your agents from anywhere, with no Tailscale, VPN or public address.",
    "You want to chat with your agents, and see them give work to each other in shared channels.",
    "You do not want to keep a computer on, and want a hosted server that is available today.",
  ],
  rivalPlans:
    "Paperclip runs the agent tools that you install and sign in yourself, such as Claude Code, Codex, Cursor, Gemini CLI, OpenCode, Pi, Hermes Agent, Grok Build, Kimi Code and OpenClaw, or any process or HTTP service that can get a heartbeat. Paperclip itself is free under the MIT license.",
  chooseRival: [
    "You want an org chart, goals, budgets for each agent and approval stages, as in a company.",
    "You need the MIT license, for example for commercial use.",
    "You run several companies, each with its own agents and data, in one deployment.",
    "You want to connect many agent tools, or your own scripts and HTTP services, as agents.",
  ],
  rows: [
    {
      icon: "cpu",
      topic: "Models and plans",
      openbot:
        "Use the plans you already have: ChatGPT, Claude, Gemini, Grok, Cursor or Cline. Or run free models and your own model through OpenCode. Choose one for each agent, and change it later.",
      rival:
        "Bring your own agent tools: Claude Code, Codex, Cursor, Gemini CLI, OpenCode, Pi, Hermes Agent, Grok Build, Kimi Code, OpenClaw, or a script or HTTP service. You install and sign in to each one.",
    },
    {
      icon: "laptop",
      topic: "Where agents work",
      openbot: "On the computer that runs OpenBot.",
      rival:
        "On the computer that runs the Paperclip server, or in remote sandboxes and cloud agents that you connect to it. The Paperclip server runs on your laptop, a server, Docker, or a cloud host that you set up.",
    },
    {
      icon: "contact",
      topic: "How you work with agents",
      openbot:
        "You chat with them. Agents give work to each other in shared channels, and you step in when a decision needs you. They can also answer in Slack, Discord and Telegram.",
      rival:
        "Through tickets on a dashboard. Agents wake on a schedule or when a task comes to them. Agent Chat and chat connectors are experimental, and you turn them on in the instance settings.",
      better: "openbot",
    },
    {
      icon: "cloud",
      topic: "When your computer is off",
      openbot:
        "Agents keep working on the computer or server that runs OpenBot, and routines start them on a schedule. If you do not want to keep a computer on, use a hosted OpenBot server in the EU, from €20 or $25 a month.",
      rival:
        "The Paperclip server must stay on to start its agents. Paperclip Cloud has a waitlist only, with no date or price; until it opens, you set up and run your own server.",
      better: "openbot",
    },
    {
      icon: "phone",
      topic: "Phones and remote access",
      openbot:
        "Apps for iPhone and Android connect from anywhere, over an encrypted connection between your devices, with no VPN. No cloud stores your chats or files.",
      rival:
        "No app for iPhone or Android: you open the web UI in a browser. By default it listens only on the computer itself; to reach it from your phone, you set up Tailscale, a VPN, your local network or a public address.",
      better: "openbot",
    },
    {
      icon: "users",
      topic: "Teams",
      openbot:
        "Each agent is a full coding agent with its own job. They give work to each other in shared channels, and coworkers can join one team host.",
      rival:
        "Agents have a boss, a title and a job in an org chart, with budgets and approval stages. People can join after you turn on sign-in from the server's shell.",
    },
    {
      icon: "lock",
      topic: "Your data",
      openbot:
        "Workspaces, chats and files stay in a database on your computer. The provider you choose gets the requests you send. Product analytics, with no chat content, are on by default and linked to your account when you sign in; you can turn them off.",
      rival:
        "By default, tasks, agents and files stay in a Postgres database and in files on the computer that runs Paperclip. Usage telemetry, with no prompts or model output, is on by default; you can turn it off.",
    },
    {
      icon: "tag",
      topic: "Price and account",
      openbot:
        "Free for noncommercial use; commercial use needs a license. Your agents use the plans you already pay for.",
      rival:
        "Free under the MIT license, also for commercial use, with no Paperclip account. You pay for the agent tools, and for a server if you rent one.",
      better: "rival",
    },
    {
      icon: "download",
      topic: "Apps and setup",
      openbot: "Download the app for macOS, Windows or Linux and open it. Mobile apps for iPhone and Android.",
      rival:
        "A Node.js server with a web UI. You install Node.js 24.11 or later and start it from a terminal with npx.",
      better: "openbot",
    },
    {
      icon: "code",
      topic: "Source code",
      openbot: "On GitHub, under the PolyForm Noncommercial License 1.0.0.",
      rival: "On GitHub, under the MIT License.",
    },
  ],
  intro:
    'Paperclip says: "If OpenClaw is an employee, Paperclip is the company." It is a Node.js server with a web UI that runs agent tools such as Claude Code and Codex as a company: an org chart, goals, tickets, budgets and approval stages. OpenBot also runs a team of agents, on a computer that you choose, with the AI plans you already pay for. The difference is how you set it up and how you work with the agents. Paperclip is a server that you start from a terminal and reach in a browser, and you manage tickets. OpenBot is an app that you download. You chat with your agents, and your phone reaches them from anywhere.',
  sections: [
    {
      title: "Models and the plans you pay for",
      openbot:
        "OpenBot runs the provider tools you already use, with the plans you already pay for: Codex with your ChatGPT plan, Claude Code with your Claude plan, Gemini with your Google AI Pro or Ultra plan, Grok CLI with your Grok account or an xAI API key, Cursor CLI with your Cursor plan or a Cursor API key, and Cline with your Cline account. OpenCode runs free models, or your own model on any OpenAI-compatible server, also one on your computer. You choose the provider, the model and the reasoning effort for each agent. When you move an agent to a different provider, it keeps its role, workspace and conversation.",
      rival:
        "Paperclip does not run models itself: it runs agent tools through adapters. It lists Claude Code, Codex, Cursor and Cursor Cloud, Gemini CLI, OpenCode, Pi, Hermes Agent, Grok Build, Kimi Code and OpenClaw, and also runs your own processes, HTTP services and adapter packages. Paperclip installs no agent tools for you, unless you use its Docker or sandbox image: you install each one and sign in with its own account or API key. You choose the tool and the model for each agent.",
    },
    {
      title: "Where the work happens",
      openbot:
        "OpenBot runs on the computer that hosts it. Agent workspaces, conversations and app data stay on that computer, so it must stay on while its agents work. Run it on a desktop or a server that stays on, and your agents keep working while your laptop is closed. If you do not want to keep a computer on, use a hosted OpenBot server. It is a Linux server in the EU (Germany, Finland or France), from €20 or $25 a month, and it keeps the workspaces and chats of its agents. Local-first is not offline: an agent that uses a hosted provider still sends its requests to that provider.",
      rival:
        "Paperclip runs as one Node.js process on the computer that you choose, with an embedded Postgres database and files on that computer. You can also use your own Postgres, run it in Docker, or deploy it to a server or a cloud host. Agents can also work in remote sandboxes, such as Daytona or e2b, but the server must stay on to start them. Agents wake on a schedule or when a task comes to them. Paperclip Cloud has a waitlist, with no published date or price.",
      better: "openbot",
    },
    {
      title: "Setup",
      openbot:
        "Download OpenBot for macOS, Windows or Linux, open it, and sign in to the provider tools that you want to use. OpenBot downloads and pins its own copy of each provider tool, or uses the one you installed. You set up no server, runtime or database: the app keeps its data in a SQLite database on your computer.",
      rival:
        "You install Node.js 24.11 or later and run npx paperclipai onboard in a terminal. Paperclip then runs as a local server, and you open its web UI in a browser. By default it is in local trusted mode: no sign-in, and it listens only on the computer itself. For other people or devices, you change the deployment mode on the server and claim ownership with a one-time link from the server log.",
      better: "openbot",
    },
    {
      title: "Phones and remote access",
      openbot:
        "The OpenBot apps for iPhone and Android connect to the computer that runs your agents. From anywhere, you chat with them, follow their progress, approve their actions and send files. The connection goes directly between your devices when it can, it is encrypted, and no cloud stores your chats or files. You set up no VPN or tunnel. Agents can also answer in Slack, Discord and Telegram. Remote access needs an OpenBot account.",
      rival:
        "Paperclip says that you can manage your agents from your phone, in its web UI; it lists no app for iPhone or Android. To reach the server from another device, you switch it to authenticated mode and then use Tailscale, a VPN or your local network, or a public deployment with its own public URL.",
      better: "openbot",
    },
    {
      title: "How agents work as a team",
      openbot:
        "In OpenBot, each agent is a full coding agent: Codex, Claude Code, Gemini, Grok CLI, Cursor CLI, Cline or OpenCode, each with its own job and workspace. A lead agent can give parts of a task to other agents in a shared channel. You chat with them, follow their work and step in when a decision needs you. For a team of people, one computer runs the host and the others join it; the chats and files stay on the host.",
      rival:
        "Paperclip organises agents as a company. Each agent has a boss, a title and a job in an org chart, and work is in tickets that trace back to the company goals. Agents wake on a schedule or when a task comes to them, and give work up and down the org chart. You approve new agents and set a budget for each one; at the limit, Paperclip pauses the agent. One deployment can run several companies, each with its own agents and data. Agent Chat is experimental.",
    },
    {
      title: "Data and privacy",
      openbot:
        "OpenBot keeps workspaces, conversations, attachments and browser data in a SQLite database on the computer that runs it. OpenBot keeps no other copy. On a hosted OpenBot server, the database is on that server in the EU. An account holds your profile, team memberships, invitations, sign-in sessions, the settings that let devices find each other, and any agent templates that you publish. Product analytics, which never include chat content, are on by default and linked to your account when you sign in; you can turn them off in Settings.",
      rival:
        "Paperclip keeps tasks, agents, comments and files in a Postgres database and in files on the computer that runs it, and needs no Paperclip account. Usage telemetry is on by default; its rules exclude prompts, model output, secrets and private paths. You turn it off with PAPERCLIP_TELEMETRY_DISABLED=1, DO_NOT_TRACK=1, or its config file.",
    },
  ],
  faq: [
    {
      question: "Is OpenBot an alternative to Paperclip?",
      answer:
        "Yes. Both run a team of AI agents on a computer that you choose, with agent tools such as Codex and Claude Code. OpenBot is an app that you download. You chat with your agents, and your phone reaches them from anywhere. Paperclip is a server with a web UI, and you manage your agents through tickets, an org chart and budgets.",
    },
    {
      question: "What is the main difference between OpenBot and Paperclip?",
      answer:
        "How you work with the agents. In OpenBot, you chat with a team of agents, and they give work to each other in shared channels. In Paperclip, you run the agents as a company: you set goals, approve new agents and budgets, and follow their work in tickets.",
    },
    {
      question: "Does Paperclip have an app for iPhone or Android?",
      answer:
        "Paperclip lists no app for iPhone or Android. Its web UI works in a phone's browser, when your phone can reach the server. OpenBot has apps for iPhone and Android that connect from anywhere.",
    },
    {
      question: "Do I need Tailscale or a VPN to reach my agents from my phone?",
      answer:
        "With OpenBot, no: the apps connect over an encrypted connection between your devices, with no VPN or tunnel. With Paperclip, the server listens only on its own computer by default; you switch it to authenticated mode, and reach it through Tailscale, a VPN, your local network or a public deployment.",
    },
    {
      question: "Is there a Paperclip cloud?",
      answer:
        "Paperclip Cloud has a waitlist, with no published date or price. Until then, you run Paperclip on your own computer or server. If you do not want to keep a computer on for OpenBot, a hosted OpenBot server in the EU is available today, from €20 or $25 a month.",
    },
    {
      question: "Do agents keep working when my laptop is closed?",
      answer:
        "Yes, with both, when they run on a computer that stays on. With OpenBot, run it on a desktop, a server or a hosted OpenBot server, and connect from your laptop or phone. With Paperclip, run the server on a computer or a cloud host that stays on.",
    },
    {
      question: "How much do OpenBot and Paperclip cost?",
      answer:
        "Both are free. OpenBot is free for noncommercial use, and commercial use needs a separate license. Paperclip is free under the MIT License. With both, you pay for the agent tools or the model provider, and for a server if you rent one.",
    },
    {
      question: "Is Paperclip open source?",
      answer:
        "Yes. Paperclip is on GitHub under the MIT License, which also allows commercial use. OpenBot's source code is on GitHub under the PolyForm Noncommercial License 1.0.0, and commercial use needs a separate license.",
    },
  ],
  sources: [
    { label: "Paperclip", url: "https://paperclip.ing/" },
    { label: "Paperclip on GitHub", url: PAPERCLIP_REPO },
    { label: "Paperclip license", url: `${PAPERCLIP_REPO}/blob/master/LICENSE` },
    { label: "Paperclip for AI assistants (llms.txt)", url: "https://paperclip.ing/llms.txt" },
    { label: "Paperclip documentation", url: PAPERCLIP_DOCS },
    { label: "Paperclip: enable multi-user login", url: `${PAPERCLIP_DOCS}/how-to/enable-multi-user-login/` },
    { label: "Paperclip: deployment modes", url: `${PAPERCLIP_REPO}/blob/master/docs/deploy/deployment-modes.md` },
    {
      label: "Paperclip: Tailscale private access",
      url: `${PAPERCLIP_REPO}/blob/master/docs/deploy/tailscale-private-access.md`,
    },
    {
      label: "Paperclip telemetry settings",
      url: `${PAPERCLIP_REPO}/blob/master/packages/shared/src/telemetry/config.ts`,
    },
    {
      label: "Paperclip telemetry rules",
      url: `${PAPERCLIP_REPO}/blob/master/packages/shared/src/telemetry/README.md`,
    },
    { label: "Paperclip Cloud waitlist", url: "https://paperclip.ing/waitlist/" },
    { label: "OpenBot privacy notes", url: OPENBOT_LINKS.privacy },
    { label: "OpenBot source code", url: OPENBOT_LINKS.repository },
  ],
  checkedAt: "2026-10-23",
};
