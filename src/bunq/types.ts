export interface BunqApiEnvelope {
  Response?: Array<Record<string, unknown>>;
  Error?: Array<{ error_description?: string; error_description_translated?: string; error_field?: string }>;
  Pagination?: {
    older_url?: string | null;
    newer_url?: string | null;
    future_url?: string | null;
    previous_url?: string | null;
  };
}

export interface BunqAmount {
  value: string;
  currency: string;
}

export interface BunqAliasIban {
  iban?: string;
  display_name?: string;
}

export interface BunqPayment {
  id: number;
  created: string;
  updated: string;
  amount: BunqAmount;
  description?: string;
  merchant_reference?: string;
  status?: string;
  type?: string;
  sub_type?: string;
  alias?: BunqAliasIban;
  counterparty_alias?: BunqAliasIban;
  balance_after_mutation?: BunqAmount;
}

export interface BunqMonetaryAccount {
  id: number;
  description?: string;
  status?: string;
  alias?: BunqAliasIban[];
  balance?: BunqAmount;
  public_uuid?: string;
  monetary_account_profile?: {
    display_name?: string;
  };
}

export interface NormalizedAccount {
  id: number;
  type: string;
  description: string;
  status: string;
  iban: string | null;
  displayName: string | null;
  balanceValue: number | null;
  balanceCurrency: string | null;
}

export interface NormalizedTransaction {
  userId: number;
  monetaryAccountId: number;
  paymentId: number;
  amountValue: number;
  amountCurrency: string;
  direction: "incoming" | "outgoing";
  description: string;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  reference: string | null;
  createdAt: string;
  updatedAt: string;
  raw: BunqPayment;
}
