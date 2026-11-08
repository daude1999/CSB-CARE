/**
 * Billing-provider abstraction for Evantix subscriptions. No provider has been chosen yet (Stripe, GoCardless or
 * another), so none is connected: the Admin Centre keeps internal subscription records only and says plainly that no
 * payment is taken and no invoice is issued. A provider is added by implementing BillingProvider and selecting it with
 * BILLING_PROVIDER; nothing here pretends a payment succeeded.
 */
export interface BillingInvoice {
  id: string;
  number: string;
  issuedAt: Date;
  amountPence: number;
  currency: string;
  status: "draft" | "open" | "paid" | "void" | "uncollectible";
  url?: string;
}

export interface BillingProvider {
  /** e.g. "stripe". */
  name: string;
  /** Creates or finds the provider's customer for an organisation and returns the provider's reference. */
  ensureCustomer(input: { organisationId: string; reference: string; legalName: string; email: string | null }): Promise<string>;
  /** Invoices the provider holds for one customer reference. */
  listInvoices(providerCustomerRef: string): Promise<BillingInvoice[]>;
}

export interface BillingStatus {
  connected: boolean;
  provider: string | null;
  message: string;
}

const PROVIDERS: Record<string, () => BillingProvider> = {
  // No provider implementation exists yet. Add one here once Evantix chooses its billing provider.
};

export function billingProvider(): BillingProvider | null {
  const which = process.env.BILLING_PROVIDER?.trim().toLowerCase();
  if (!which) return null;
  const make = PROVIDERS[which];
  return make ? make() : null;
}

export function billingStatus(): BillingStatus {
  const which = process.env.BILLING_PROVIDER?.trim().toLowerCase() || null;
  if (!which) return { connected: false, provider: null, message: "No billing provider is connected. Subscriptions are internal records only: no payment is taken and no invoice is issued from this platform." };
  if (!PROVIDERS[which]) return { connected: false, provider: which, message: `BILLING_PROVIDER is set to "${which}", but this platform has no integration for it yet. Nothing is charged.` };
  return { connected: true, provider: which, message: `Connected to ${which}.` };
}
