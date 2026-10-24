// The Vault of this computer: logins, payment cards and contact info that every agent can fill into
// a page. A list answer never carries a password, a card number or a security code: the renderer gets
// one of them only from `vault:reveal`, when the user asks for it.

export type VaultItemKind = "login" | "card" | "contact";

/** The name of the agent that added an item, as it was then. Absent when the user added it. */
export interface VaultItemOrigin {
  addedBy?: string;
}

export type VaultCardBrand = "visa" | "mastercard" | "amex" | "discover";

/** A value that the list never returns. */
export type VaultSecretField = "password" | "number" | "securityCode";

export interface VaultLoginSummary extends VaultItemOrigin {
  id: string;
  kind: "login";
  /** An `https:` address or a host name, as the user typed it. */
  website: string;
  username: string;
  notes: string;
  hasPassword: boolean;
}

export interface VaultCardSummary extends VaultItemOrigin {
  id: string;
  kind: "card";
  label: string;
  nameOnCard: string;
  brand: VaultCardBrand | null;
  last4: string;
  /** 1–12. */
  expMonth: number;
  /** Four digits. */
  expYear: number;
  billingContactId: string | null;
}

export interface VaultContactFields {
  label: string;
  fullName: string;
  address: string;
  address2: string;
  city: string;
  region: string;
  postalCode: string;
  /** An ISO 3166-1 alpha-2 code, or "" when not set. */
  country: string;
  phone: string;
  email: string;
}

export interface VaultContactSummary extends VaultContactFields, VaultItemOrigin {
  id: string;
  kind: "contact";
}

export type VaultItemSummary = VaultLoginSummary | VaultCardSummary | VaultContactSummary;

/**
 * - `ready`: the items can be read and changed.
 * - `unavailable`: this computer has no secret storage (Linux without a keyring), so nothing can be saved.
 * - `unreadable`: the file is there but cannot be decrypted. It is kept until the user resets the Vault.
 */
export type VaultStatus = "ready" | "unavailable" | "unreadable";

export interface VaultState {
  status: VaultStatus;
  items: VaultItemSummary[];
}

/** A new item when `id` is null. A null secret keeps the saved value. */
export type VaultSaveInput =
  | {
      kind: "login";
      id: string | null;
      website: string;
      username: string;
      notes: string;
      password: string | null;
    }
  | {
      kind: "card";
      id: string | null;
      label: string;
      nameOnCard: string;
      expMonth: number;
      expYear: number;
      billingContactId: string | null;
      number: string | null;
      securityCode: string | null;
    }
  | ({ kind: "contact"; id: string | null } & VaultContactFields);

export interface VaultSecretRequest {
  id: string;
  field: VaultSecretField;
}

/** Null when the user closed the file dialog. */
export type VaultImportResult = { imported: number; skipped: number; state: VaultState } | null;

export const EMPTY_VAULT: VaultState = { status: "ready", items: [] };

export const VAULT_TEXT_LIMIT = 512;
export const VAULT_NOTES_LIMIT = 4096;
export const VAULT_PASSWORD_LIMIT = 1024;
