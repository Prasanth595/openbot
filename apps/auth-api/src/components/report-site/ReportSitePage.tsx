import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import type { JSX } from "@solidjs/web";
import { Link } from "@tanstack/solid-router";
import { createSignal, createUniqueId, For, Show } from "solid-js";
import { CONTACT_EMAIL } from "../../lib/contact";
import { LandingFooter } from "../landing/LandingFooter";
import { LandingIcon } from "../landing/LandingIcon";
import { SiteHeader } from "../landing/SiteHeader";

/** The reasons that `/v1/sites/reports` accepts. */
const REPORT_REASONS = [
  { id: "phishing", label: "Phishing" },
  { id: "malware", label: "Malware" },
  { id: "abuse", label: "Abuse" },
  { id: "copyright", label: "Copyright" },
  { id: "other", label: "Other" },
] as const;

const DETAILS_LIMIT = 1_000;

type ReportStatus = "idle" | "sending" | "sent" | "failed";

function fieldText(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** The `error.message` of a refused report, when the server sent one that a person can read. */
async function serverMessage(response: Response): Promise<string | null> {
  if (response.status >= 500) return null;
  const body = await response.json().catch(() => null);
  if (!isDynamicRecord(body) || !isDynamicRecord(body.error)) return null;
  return isString(body.error.message) && body.error.message ? body.error.message : null;
}

/**
 * The form state and the send to `/v1/sites/reports`. The endpoint accepts only a same-origin form
 * body, so the page sends `application/x-www-form-urlencoded` with `fetch`, and the browser adds the
 * `Origin` and `Sec-Fetch-Site` headers that it checks.
 */
function createReportForm() {
  const [status, setStatus] = createSignal<ReportStatus>("idle");
  const [hostnameError, setHostnameError] = createSignal<string>();
  const [failure, setFailure] = createSignal("");

  const submit: JSX.EventHandler<HTMLFormElement, SubmitEvent> = async (event) => {
    event.preventDefault();
    if (status() === "sending") return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const hostname = fieldText(data, "hostname");
    if (!hostname) {
      setHostnameError("Enter the site address");
      const field = form.elements.namedItem("hostname");
      if (field instanceof HTMLElement) field.focus();
      return;
    }
    setHostnameError(undefined);
    setStatus("sending");
    const response = await fetch("/v1/sites/reports", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        hostname,
        reason: fieldText(data, "reason"),
        details: fieldText(data, "details"),
      }),
    }).catch(() => null);
    if (response?.status === 201) {
      setStatus("sent");
      return;
    }
    if (response?.status === 429) setFailure("Too many reports. Try again later.");
    else setFailure((response && (await serverMessage(response))) ?? "Could not send the report. Try again.");
    setStatus("failed");
  };

  return { status, hostnameError, failure, submit };
}

function SentNotice() {
  return (
    <div class="contact-sent" role="status">
      <span class="contact-sent-mark">
        <LandingIcon name="check" />
      </span>
      <h2>Report sent</h2>
      <p>Thanks. We received your report.</p>
      <Link to="/" class="contact-text-button">
        Go to the home page
      </Link>
    </div>
  );
}

/** The report form for a hosted site. `hostname` is the site that linked here, or empty. */
export function ReportSitePage(props: { hostname: string }) {
  const form = createReportForm();
  const hostnameId = createUniqueId();
  const reasonId = createUniqueId();
  const detailsId = createUniqueId();
  const [detailsLength, setDetailsLength] = createSignal(0);

  return (
    <div class="landing-page">
      <SiteHeader page="content" />
      <main>
        <section class="landing-section contact-section" data-revealed="true" aria-labelledby="report-site-title">
          <div class="landing-section-inner">
            <div class="landing-faq-layout">
              <header class="landing-section-heading landing-faq-heading">
                <h1 id="report-site-title">Report a hosted site</h1>
                <p>Send a report about harmful or unlawful content on an openbot.site address.</p>
              </header>
              <div class="contact-card">
                <Show when={form.status() !== "sent"} fallback={<SentNotice />}>
                  <form class="contact-form" novalidate onSubmit={form.submit}>
                    <div class="contact-field">
                      <div class="contact-field-head">
                        <label for={hostnameId}>Site address</label>
                        <Show when={form.hostnameError()}>
                          {(error) => (
                            <span id={`${hostnameId}-error`} class="contact-error">
                              {error()}
                            </span>
                          )}
                        </Show>
                      </div>
                      <input
                        id={hostnameId}
                        name="hostname"
                        type="text"
                        value={props.hostname}
                        readonly={props.hostname !== ""}
                        placeholder="example.openbot.site"
                        autocomplete="off"
                        spellcheck={false}
                        aria-invalid={form.hostnameError() ? "true" : undefined}
                        aria-describedby={form.hostnameError() ? `${hostnameId}-error` : undefined}
                      />
                    </div>
                    <div class="contact-field">
                      <div class="contact-field-head">
                        <label for={reasonId}>Reason</label>
                      </div>
                      <div class="contact-select">
                        <select id={reasonId} name="reason">
                          <For each={REPORT_REASONS}>
                            {(reason) => <option value={reason.id}>{reason.label}</option>}
                          </For>
                        </select>
                        <LandingIcon name="chevron-down" class="contact-select-icon" />
                      </div>
                    </div>
                    <div class="contact-field">
                      <div class="contact-field-head">
                        <label for={detailsId}>Details</label>
                        <span class="contact-optional">Optional</span>
                      </div>
                      <textarea
                        id={detailsId}
                        name="details"
                        rows={5}
                        maxlength={DETAILS_LIMIT}
                        placeholder="What is wrong with this site?"
                        aria-describedby={`${detailsId}-count`}
                        onInput={(event) => setDetailsLength(event.currentTarget.value.length)}
                      />
                      {/* One expression: the server writes a constant as text, but the client expects a slot. */}
                      <span id={`${detailsId}-count`} class="contact-count">
                        {`${detailsLength()} / ${DETAILS_LIMIT}`}
                      </span>
                    </div>
                    <div class="contact-submit">
                      <button
                        type="submit"
                        class="landing-button landing-button-primary landing-button-md"
                        data-icon="arrow-right"
                        disabled={form.status() === "sending"}
                      >
                        {form.status() === "sending" ? "Sending…" : "Send report"}
                      </button>
                      <Show when={form.status() === "failed"}>
                        <p class="contact-privacy contact-failed" role="alert">
                          {form.failure()} You can also write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
                          .
                        </p>
                      </Show>
                    </div>
                  </form>
                </Show>
              </div>
            </div>
          </div>
        </section>
      </main>
      <LandingFooter />
    </div>
  );
}
