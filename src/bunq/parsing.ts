import type {
  BunqApiEnvelope,
  BunqMonetaryAccount,
  BunqPayment,
  NormalizedAccount,
  NormalizedTransaction
} from "./types.js";

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

export function extractResponseObjects(envelope: BunqApiEnvelope): Array<Record<string, unknown>> {
  return envelope.Response ?? [];
}

export function findResponseObject<T>(
  envelope: BunqApiEnvelope,
  predicate: (key: string, value: unknown) => boolean
): T | null {
  for (const row of envelope.Response ?? []) {
    for (const [key, value] of Object.entries(row)) {
      if (predicate(key, value)) {
        return value as T;
      }
    }
  }

  return null;
}

export function extractUserIdFromSession(envelope: BunqApiEnvelope): number {
  const userObject = findResponseObject<Record<string, unknown>>(
    envelope,
    (key) => key.startsWith("User")
  );

  const id = userObject?.id;
  if (typeof id === "number") {
    return id;
  }

  throw new Error("Unable to determine user id from bunq session response");
}

export function parseInstallationData(envelope: BunqApiEnvelope): {
  installationToken: string;
  serverPublicKeyPem: string;
} {
  const tokenObject = findResponseObject<{ token?: string }>(
    envelope,
    (key) => key === "Token"
  );
  const serverPublicKeyObject = findResponseObject<{ server_public_key?: string }>(
    envelope,
    (key) => key === "ServerPublicKey"
  );

  const installationToken = tokenObject?.token;
  const serverPublicKeyPem = serverPublicKeyObject?.server_public_key;

  if (!installationToken || !serverPublicKeyPem) {
    throw new Error("Installation response did not include token or server public key");
  }

  return { installationToken, serverPublicKeyPem };
}

export function parseSessionToken(envelope: BunqApiEnvelope): string {
  const tokenObject = findResponseObject<{ token?: string }>(
    envelope,
    (key) => key === "Token"
  );
  const token = tokenObject?.token;
  if (!token) {
    throw new Error("Session response did not include token");
  }
  return token;
}

export function parseMonetaryAccounts(envelope: BunqApiEnvelope): NormalizedAccount[] {
  const accounts: NormalizedAccount[] = [];

  for (const row of envelope.Response ?? []) {
    for (const [key, value] of Object.entries(row)) {
      if (!key.startsWith("MonetaryAccount")) {
        continue;
      }
      const acct = value as BunqMonetaryAccount;
      const alias = acct.alias?.find((candidate) => Boolean(candidate.iban));
      const balanceValue = toNumber(acct.balance?.value);
      accounts.push({
        id: acct.id,
        type: key,
        description: acct.description ?? "",
        status: acct.status ?? "UNKNOWN",
        iban: alias?.iban ?? null,
        displayName: acct.monetary_account_profile?.display_name ?? alias?.display_name ?? null,
        balanceValue,
        balanceCurrency: acct.balance?.currency ?? null
      });
    }
  }

  return accounts;
}

export function parsePayments(
  envelope: BunqApiEnvelope,
  userId: number,
  monetaryAccountId: number
): NormalizedTransaction[] {
  const out: NormalizedTransaction[] = [];

  for (const row of envelope.Response ?? []) {
    const payment = row.Payment as BunqPayment | undefined;
    if (!payment?.id) {
      continue;
    }

    const amountValue = Number(payment.amount.value);
    const direction: "incoming" | "outgoing" = amountValue >= 0 ? "incoming" : "outgoing";
    const counterparty = payment.counterparty_alias ?? payment.alias;
    out.push({
      userId,
      monetaryAccountId,
      paymentId: payment.id,
      amountValue,
      amountCurrency: payment.amount.currency,
      direction,
      description: payment.description ?? "",
      counterpartyName: counterparty?.display_name ?? null,
      counterpartyIban: counterparty?.iban ?? null,
      reference: payment.merchant_reference ?? null,
      createdAt: payment.created,
      updatedAt: payment.updated,
      raw: payment
    });
  }

  return out;
}

export function parseSinglePayment(
  envelope: BunqApiEnvelope,
  userId: number,
  monetaryAccountId: number
): NormalizedTransaction | null {
  const parsed = parsePayments(envelope, userId, monetaryAccountId);
  return parsed.length ? (parsed[0] ?? null) : null;
}
