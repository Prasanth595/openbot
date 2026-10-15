import type { ErrorReceiptInput } from "@openbot/contracts/ipc";
import type { FailureProperties, NotificationMetadata } from "@openbot/telemetry";
import type { JSX } from "@solidjs/web";
import { createContext, createEffect, createSignal, omit, useContext } from "solid-js";
import { ErrorReference } from "./error-reference";
import { cx } from "./utils";

export type AlertTone = "neutral" | "success" | "warning" | "danger";

export interface AlertProps extends JSX.HTMLAttributes<HTMLDivElement> {
  tone?: AlertTone;
  report?: NotificationMetadata | false;
  receiptPresentation?: "banner" | "confirmation_dialog";
  /** A new error in an open dialog is a new display occurrence. Never retained. */
  receiptOccurrence?: unknown;
}

export type ErrorReceiptObserver = (input: ErrorReceiptInput) => Promise<string | undefined>;
const NotificationContext = createContext<{
  onShown: (report: FailureProperties) => void;
  onErrorShown?: ErrorReceiptObserver;
} | null>(null);

/** Applications observe presentations. The shared UI does not send or store reports. */
export function NotificationObserver(props: {
  onShown: (report: FailureProperties) => void;
  onErrorShown?: ErrorReceiptObserver;
  children?: JSX.Element;
}): JSX.Element {
  return <NotificationContext value={props}>{props.children}</NotificationContext>;
}

export function Alert(props: AlertProps): JSX.Element {
  const observe = useContext(NotificationContext);
  const [receiptId, setReceiptId] = createSignal<string>();
  createEffect(
    () => ({ tone: props.tone, occurrence: props.receiptOccurrence }),
    ({ tone }) => {
      setReceiptId(undefined);
      if (tone !== "danger" && tone !== "warning") return;
      const metadata = props.report === false ? undefined : props.report;
      const operation = metadata?.operation ?? "other";
      const cause = metadata?.cause_code ?? "unknown";
      const presentation = props.receiptPresentation ?? "banner";
      if (props.report !== false && presentation === "banner")
        observe?.onShown({
          ...metadata,
          operation,
          source: metadata?.source ?? "system",
          cause_code: cause,
          severity: tone === "danger" ? "error" : "warning",
          presentation: "banner",
        });
      let active = true;
      if (tone === "danger")
        void observe
          ?.onErrorShown?.({ presentation, operation, cause })
          .then((id) => {
            if (active) setReceiptId(id);
          })
          .catch(() => undefined);
      return () => {
        active = false;
      };
    },
  );
  const others = omit(props, "class", "tone", "report", "receiptPresentation", "receiptOccurrence", "children");
  return (
    <div class={cx("ui-alert", props.class)} data-tone={props.tone ?? "neutral"} {...others}>
      {props.children}
      <ErrorReference reference={undefined} receiptId={receiptId()} />
    </div>
  );
}

export function AlertIcon(props: JSX.HTMLAttributes<HTMLSpanElement>): JSX.Element {
  const others = omit(props, "class");
  return <span class={cx("ui-alert-icon", props.class)} aria-hidden="true" {...others} />;
}

export function AlertContent(props: JSX.HTMLAttributes<HTMLDivElement>): JSX.Element {
  const others = omit(props, "class");
  return <div class={cx("ui-alert-content", props.class)} {...others} />;
}

export function AlertTitle(props: JSX.HTMLAttributes<HTMLElement>): JSX.Element {
  const others = omit(props, "class");
  return <strong class={cx("ui-alert-title", props.class)} {...others} />;
}

export function AlertDescription(props: JSX.HTMLAttributes<HTMLSpanElement>): JSX.Element {
  const others = omit(props, "class");
  return <span class={cx("ui-alert-description", props.class)} {...others} />;
}

export function AlertActions(props: JSX.HTMLAttributes<HTMLDivElement>): JSX.Element {
  const others = omit(props, "class");
  return <div class={cx("ui-alert-actions", props.class)} {...others} />;
}
