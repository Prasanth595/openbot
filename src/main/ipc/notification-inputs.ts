import {
  type ErrorReceiptInput,
  type ErrorReceiptQuery,
  RECEIPT_CAUSES,
  RECEIPT_CURSOR_PATTERN,
  RECEIPT_OPERATIONS,
  RECEIPT_PRESENTATIONS,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isOneOf } from "@openbot/contracts/runtime-values";

/** Reject without including the untrusted payload in errors or logs. */
export function parseErrorReceiptInput(value: unknown): ErrorReceiptInput {
  if (
    !isDynamicRecord(value) ||
    Object.keys(value).length !== 3 ||
    !isOneOf(RECEIPT_PRESENTATIONS, value.presentation) ||
    !isOneOf(RECEIPT_OPERATIONS, value.operation) ||
    !isOneOf(RECEIPT_CAUSES, value.cause)
  )
    throw new Error("Invalid local receipt input");
  return { presentation: value.presentation, operation: value.operation, cause: value.cause };
}

export function parseErrorReceiptQuery(value: unknown): ErrorReceiptQuery {
  if (!isDynamicRecord(value) || Object.keys(value).some((key) => key !== "after" && key !== "limit"))
    throw new Error("Invalid local receipt query");
  const { after, limit } = value;
  if (after !== undefined && (typeof after !== "string" || !RECEIPT_CURSOR_PATTERN.test(after)))
    throw new Error("Invalid local receipt cursor");
  if (limit !== undefined && (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 50))
    throw new Error("Invalid local receipt limit");
  return { ...(after === undefined ? {} : { after }), ...(limit === undefined ? {} : { limit }) };
}
