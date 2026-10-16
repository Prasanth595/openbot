import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { SideQuestionExchange } from "@openbot/ui/features/conversation/SideQuestionPanel";
import { currentText } from "@openbot/ui/text";
import { createStore } from "solid-js";
import { createScopeGuard } from "../../../scope-lifetime";
import { conversationPort } from "../conversation-port";
import type { ConversationProps } from "../conversation-types";

// Each member reads the interface language when it is called.
const { t, errorMessage } = currentText();

/** The side question of one agent. Only this window holds it: nothing on the host keeps it. */
export interface SideQuestionState {
  draft: string;
  exchanges: SideQuestionExchange[];
  error: string | null;
  focusRequest: number;
}

const SIDE_QUESTION_EMPTY: SideQuestionState = { draft: "", exchanges: [], error: null, focusRequest: 0 };

export interface SideQuestionStoreDeps {
  props: ConversationProps;
  /** Opens the side question pane of the agent on screen. */
  openPane: () => void;
}

export function createSideQuestionStore(deps: SideQuestionStoreDeps) {
  const scopeActive = createScopeGuard();
  const [questions, setQuestions] = createStore<Record<string, SideQuestionState>>({});
  let nextExchange = 0;

  /** Only the computer that runs the agent answers a side question. */
  const sideQuestionAvailable = () => !deps.props.runtime && (deps.props.server?.id ?? "local") === "local";
  const sideQuestion = (): SideQuestionState => {
    const agentId = deps.props.agent?.id;
    return (agentId && questions[agentId]) || SIDE_QUESTION_EMPTY;
  };
  function update(agentId: string, change: (state: SideQuestionState) => void) {
    setQuestions((draft) => {
      draft[agentId] ??= { ...SIDE_QUESTION_EMPTY, exchanges: [] };
      change(draft[agentId]);
    });
  }

  function setSideQuestionDraft(text: string) {
    const agentId = deps.props.agent?.id;
    if (!agentId) return;
    update(agentId, (state) => {
      state.draft = text;
    });
  }

  /** Opens the pane with the caret in its composer. Text from the chat composer goes to the end of its draft. */
  function openSideQuestion(text = "") {
    const agentId = deps.props.agent?.id;
    if (!agentId || !sideQuestionAvailable()) return;
    const question = text.trim();
    update(agentId, (state) => {
      if (question) state.draft = state.draft.trim() ? `${state.draft.trim()}\n${question}` : question;
      state.focusRequest += 1;
    });
    deps.openPane();
  }

  function askSideQuestion(question: string) {
    const agentId = deps.props.agent?.id;
    if (!agentId) return;
    const state = questions[agentId] ?? SIDE_QUESTION_EMPTY;
    if (state.exchanges.at(-1)?.answer === null) return;
    const earlier = state.exchanges
      .slice(-INPUT_LIMITS.sideQuestionTurns)
      .flatMap((exchange) =>
        exchange.answer === null ? [] : [{ question: exchange.question, answer: exchange.answer }],
      );
    nextExchange += 1;
    const id = `side-question-${nextExchange}`;
    update(agentId, (draft) => {
      draft.exchanges.push({ id, question, askedAt: new Date().toISOString(), answer: null, answeredAt: null });
      draft.draft = "";
      draft.error = null;
    });
    void conversationPort()
      .agent.askSideQuestion({ agentId, question, earlier })
      .then(
        (answer) => {
          if (!scopeActive() || !questions[agentId]) return;
          update(agentId, (draft) => {
            const exchange = draft.exchanges.find((item) => item.id === id);
            if (!exchange) return;
            exchange.answer = answer;
            exchange.answeredAt = new Date().toISOString();
          });
        },
        (error) => {
          if (!scopeActive() || !questions[agentId]) return;
          update(agentId, (draft) => {
            if (!draft.exchanges.some((item) => item.id === id)) return;
            // The question goes back to the composer, so that Send asks it again.
            draft.exchanges = draft.exchanges.filter((item) => item.id !== id);
            draft.error = errorMessage(error, t("conversation.sideQuestion.error"));
            if (!draft.draft.trim()) draft.draft = question;
            draft.focusRequest += 1;
          });
        },
      );
  }

  /** Closing the pane deletes the side question. An answer that comes later finds no question and is dropped. */
  function deleteSideQuestion() {
    const agentId = deps.props.agent?.id;
    if (!agentId) return;
    setQuestions((draft) => {
      delete draft[agentId];
    });
  }

  return {
    sideQuestionAvailable,
    sideQuestion,
    setSideQuestionDraft,
    openSideQuestion,
    askSideQuestion,
    deleteSideQuestion,
  };
}
