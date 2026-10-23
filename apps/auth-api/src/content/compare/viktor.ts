import { OPENBOT_LINKS } from "../../lib/landing-links";
import type { Comparison } from "./comparison";

// Every statement about Viktor here is taken from viktor.com: its home page, pricing page,
// security page, documentation, privacy policy and general terms (both last updated
// 2026-07-31); each page used is in `sources`. Viktor is a service of Zeta AI, Inc., a
// Delaware corporation. Check them again, and move `checkedAt`, whenever this file changes.

export const VIKTOR_COMPARISON: Comparison = {
  rival: { name: "Viktor", mark: "viktor" },
  answer:
    "Choose OpenBot if you want a team of AI agents on your own computer, with your data in a database that you hold and the AI plans you already pay for: the app is free, and there are no credits to buy. Choose Viktor if you want one AI coworker in Slack or Microsoft Teams that runs in the cloud, connects to thousands of business apps, and comes with a SOC 2 report.",
  chooseOpenBot: [
    "Your chats, files and company data must stay on your own computer, not on a service's servers in the US.",
    "You already pay for ChatGPT, Claude, Gemini, Grok, Cursor or Cline, and you do not want to pay for each task again in credits.",
    "You want a team of agents, each with its own job and model, not one assistant for the whole company.",
    "You want a free app that you can download today, with source code that you can read.",
  ],
  rivalPlans:
    "Viktor chooses the models. Its security page names OpenAI, Anthropic and Google, and an admin sets the fast and the deep model for the workspace. You pay in credits: $100 in free credits to start, then a Team plan from $50 a month for 20,000 credits.",
  chooseRival: [
    "Your team works in Slack or Microsoft Teams, and you want one AI coworker that everyone mentions there.",
    "You need a ready connection to many business apps, such as Salesforce, HubSpot and Google Ads.",
    "Your company needs a vendor with a SOC 2 Type 1 report, SAML single sign-on and a DPA.",
    "You want no computer of yours to stay on.",
  ],
  rows: [
    {
      icon: "cpu",
      topic: "Models and plans",
      openbot:
        "Use the plans you already have: ChatGPT, Claude, Gemini, Grok, Cursor or Cline. Or run free models and your own model through OpenCode. Choose one for each agent, and change it later.",
      rival:
        "Viktor chooses the models. An admin can set the workspace's fast and deep model, and Viktor bills each task in credits.",
      better: "openbot",
    },
    {
      icon: "tag",
      topic: "Price",
      openbot:
        "Free for noncommercial use; commercial use needs a license. Your agents use the plans you already pay for, so there is no charge for each task.",
      rival:
        "$100 in free credits, then from $50 a month for 20,000 credits. Viktor says that 40,000 credits are about 80 to 400 tasks, and scheduled tasks use credits too.",
      better: "openbot",
    },
    {
      icon: "laptop",
      topic: "Where agents work",
      openbot: "On the computer that runs OpenBot, or on a hosted OpenBot server in the EU.",
      rival: "On Viktor's own cloud computer for your workspace, hosted on AWS in the US (us-east-1).",
      better: "openbot",
    },
    {
      icon: "lock",
      topic: "Your data",
      openbot:
        "Workspaces, chats and files stay in a database on your computer. The provider you choose gets the requests you send. Product analytics, with no chat content, are on by default and linked to your account when you sign in; you can turn them off.",
      rival:
        "Stored in the US. Viktor reads every message in the Slack channels it joins, and up to about 90 days of earlier history. EU data residency is only on Enterprise contracts.",
      better: "openbot",
    },
    {
      icon: "users",
      topic: "Teams",
      openbot:
        "Each agent is a full coding agent with its own job, model and workspace. They give work to each other in shared channels, and coworkers can join one team host.",
      rival: "One shared AI coworker for the whole workspace, with one pool of credits.",
      better: "openbot",
    },
    {
      icon: "check",
      topic: "Who approves an action",
      openbot:
        "You do. An agent shows a draft and waits for your approval before it sends a message for you, unless you or a routine that you set up tells it to send. It asks you to confirm the item, price and total before a payment.",
      rival:
        "An admin chooses which tools need approval. Under Viktor's terms, you are responsible for every message and action that it sends or takes for you.",
    },
    {
      icon: "puzzle",
      topic: "Integrations",
      openbot: "Agents use MCP servers, plugins from the OpenBot catalog, and the command-line tools on your computer.",
      rival: "More than 9,800 apps, such as Salesforce, HubSpot, Linear, Notion, Stripe and Google Ads.",
      better: "rival",
    },
    {
      icon: "phone",
      topic: "How you talk to it",
      openbot:
        "The desktop app, and apps for iPhone and Android over an encrypted connection between your devices. Agents can also answer in Slack, Discord and Telegram.",
      rival: "In Slack, Microsoft Teams or Discord, or in the Viktor web app.",
    },
    {
      icon: "globe",
      topic: "Who can use it",
      openbot:
        "Anyone, in any country: OpenBot has no region lock. The desktop app is in 10 languages, and hosted servers run in the EU.",
      rival: "Businesses only: its terms say that the service is not for consumers.",
      better: "openbot",
    },
    {
      icon: "code",
      topic: "Source code",
      openbot: "On GitHub, under the PolyForm Noncommercial License 1.0.0.",
      rival: "A closed service that runs only on Viktor's servers.",
      better: "openbot",
    },
  ],
  intro:
    "Viktor is an AI coworker that lives in Slack and Microsoft Teams. Anyone on the team mentions it, and it does the work on its own cloud computer: reports, ad campaigns, bug triage, internal apps and invoices, with more than 9,800 connected apps. OpenBot also gives you AI agents that do real work. The difference is where they run, who holds your data, and how you pay. Viktor runs in the US, reads the channels it joins, and bills each task in credits. OpenBot runs a team of agents on your own computer, keeps your data there, and uses the AI plans you already pay for.",
  sections: [
    {
      title: "Models and what you pay",
      openbot:
        "OpenBot runs the provider tools you already use, with the plans you already pay for: Codex with your ChatGPT plan, Claude Code with your Claude plan, Gemini with your Google AI Pro or Ultra plan, Grok CLI with your Grok account or an xAI API key, Cursor CLI with your Cursor plan or a Cursor API key, and Cline with your Cline account. OpenCode runs free models, or your own model on any OpenAI-compatible server, also one on your computer. You choose the provider, the model and the reasoning effort for each agent. OpenBot is free for noncommercial use, so a busy month does not cost more.",
      rival:
        "Viktor chooses the models: its security page names OpenAI, Anthropic and Google. An admin can set which model answers fast requests and which answers deep ones, but you cannot use a plan that you already pay for. You pay in credits, shared by the whole workspace. You start with up to $100 in free credits. The Team plan starts at $50 a month for 20,000 credits and goes up to $30,000 a month; Enterprise costs more. Viktor says that a quick Slack question uses about 50 to 100 credits, a deep research report 500 to 2,000, and a full project 2,000 to 5,000. Scheduled tasks use credits each time they run, and unused credits roll over for one month only.",
      better: "openbot",
    },
    {
      title: "Where the work happens",
      openbot:
        "OpenBot runs on the computer that hosts it. Agent workspaces, conversations and app data stay on that computer, so it must stay on while its agents work. Run it on a desktop or a server that stays on, and your agents keep working while your laptop is closed. If you do not want to keep a computer on, use a hosted OpenBot server. It is a Linux server in the EU (Germany, Finland or France), from €20 or $25 a month, and it keeps the workspaces and chats of its agents. Local-first is not offline: an agent that uses a hosted provider still sends its requests to that provider.",
      rival:
        "Viktor has its own computer in the cloud, where it writes and runs code. Its security page says that it is hosted on AWS in us-east-1, and that each workspace runs in a sandbox. No computer of yours must stay on. Data is in the US by default; EU data residency is only on Enterprise contracts.",
      better: "openbot",
    },
    {
      title: "What it reads, and who holds your data",
      openbot:
        "OpenBot keeps workspaces, conversations, attachments and browser data in a SQLite database on the computer that runs it. OpenBot keeps no other copy. On a hosted OpenBot server, the database is on that server in the EU. An account holds your profile, team memberships, invitations, sign-in sessions, the settings that let devices find each other, and any agent templates that you publish. Product analytics, which never include chat content, are on by default and linked to your account when you sign in; you can turn them off in Settings.",
      rival:
        "Viktor's privacy policy says that it reads all messages in the Slack channels it joins, not only the messages that mention it, and that it can get up to about 90 days of earlier history when it joins. A user can give it wider search access, which can include private channels and direct messages. Data is stored with cloud providers in US regions, and the policy names more than 30 other services that process it. Viktor says that it does not train foundation models on your data, but it can use your data for small internal models, such as one that chooses the model for a task.",
      better: "openbot",
    },
    {
      title: "How agents work as a team",
      openbot:
        "In OpenBot, each agent is a full coding agent: Codex, Claude Code, Gemini, Grok CLI, Cursor CLI, Cline or OpenCode, each with its own job, model and workspace. A lead agent can give parts of a task to other agents in a shared channel. You follow their work and step in when a decision needs you. When you move an agent to a different provider, it keeps its role, workspace and conversation. For a team of people, one computer runs the host and the others join it; the chats and files stay on the host.",
      rival:
        "Viktor is one AI coworker for the whole workspace. Everyone on the team mentions the same Viktor, it keeps one shared memory of the team, and every request uses the same pool of credits.",
      better: "openbot",
    },
    {
      title: "Approvals and responsibility",
      openbot:
        "OpenBot agents show a draft before they send a message for you. They send it after you approve it, or when you or a routine that you set up tells them to send. Before a payment, an agent reads back the item, price and total and asks you to confirm. A new agent has Full access: it does not ask before it runs a command. Set an agent to Ask first, and that agent asks you first; you answer in the chat or from a notification on your phone.",
      rival:
        "Some built-in actions, such as joining a Slack channel, always need approval in Viktor. For each integration tool, an admin chooses if it runs on its own, needs approval, or never runs, and a user can click Always approve. Viktor's terms make you responsible for all messages and actions sent or taken through your account, and you must indemnify Viktor for any action it takes through a connected app under the permissions you set.",
    },
    {
      title: "Integrations and company controls",
      openbot:
        "OpenBot agents use MCP servers, plugins from the OpenBot catalog, and the tools on the computer that runs them. They can also answer in Slack, Discord and Telegram. OpenBot has no SOC 2 report: your data stays on a computer that you control, so your own security controls apply to it.",
      rival:
        "Viktor connects to more than 9,800 apps and builds a custom integration for one it does not have. It has a SOC 2 Type 1 report; SOC 2 Type 2 and ISO 27001 are in progress. Enterprise adds SAML single sign-on, audit logs, a DPA and an SLA.",
      better: "rival",
    },
  ],
  faq: [
    {
      question: "Is OpenBot an alternative to Viktor?",
      answer:
        "Yes, if you want your agents and your data on your own computer. Both give you AI agents that do work for your team. OpenBot runs a team of agents on your computer, with the AI plans you already pay for. Viktor is one AI coworker in Slack or Microsoft Teams that runs in the US and bills each task in credits.",
    },
    {
      question: "How much does Viktor cost?",
      answer:
        "Viktor gives up to $100 in free credits. Then the Team plan starts at $50 a month for 20,000 credits; Viktor says that 40,000 credits are about 80 to 400 tasks. Enterprise has custom prices. OpenBot is free for noncommercial use, and it uses the AI plans you already pay for, with no credits.",
    },
    {
      question: "Can I use my ChatGPT or Claude plan with Viktor?",
      answer:
        "No. Viktor chooses the models and bills them in credits. OpenBot runs Codex with your ChatGPT plan, Claude Code with your Claude plan, and Gemini, Grok, Cursor and Cline with your own accounts.",
    },
    {
      question: "Does Viktor read all my Slack messages?",
      answer:
        "Viktor's privacy policy says that it reads all messages in the channels it joins, not only those that mention it, and up to about 90 days of earlier history. A user can give it wider access, which can include private channels and direct messages. OpenBot keeps your workspaces, chats and files in a database on your own computer.",
    },
    {
      question: "Where does Viktor store my data?",
      answer:
        "In the US: Viktor is hosted on AWS in us-east-1, and EU data residency is only on Enterprise contracts. OpenBot keeps your data on your computer, or on a hosted OpenBot server in the EU that you choose.",
    },
    {
      question: "Do agents keep working when my laptop is closed?",
      answer:
        "Yes, with both. Viktor works on its own cloud computer, so no computer of yours must stay on. OpenBot agents work on the computer or server that runs OpenBot: keep that computer on, or use a hosted OpenBot server, and connect from your laptop or phone.",
    },
    {
      question: "Is Viktor open source?",
      answer:
        "No. Viktor is a closed service. OpenBot's source code is on GitHub under the PolyForm Noncommercial License 1.0.0.",
    },
  ],
  sources: [
    { label: "Viktor", url: "https://viktor.com/" },
    { label: "Viktor pricing", url: "https://viktor.com/pricing" },
    { label: "Viktor security", url: "https://viktor.com/security" },
    { label: "Viktor approvals", url: "https://viktor.com/docs/approvals" },
    { label: "Viktor chat commands", url: "https://viktor.com/docs/chat-commands" },
    { label: "Viktor privacy policy", url: "https://viktor.com/legal/privacy" },
    { label: "Viktor general terms", url: "https://viktor.com/legal/general-terms" },
    { label: "OpenBot privacy notes", url: OPENBOT_LINKS.privacy },
    { label: "OpenBot source code", url: OPENBOT_LINKS.repository },
  ],
  checkedAt: "2026-10-23",
};
