// lib/prox/types.ts
//
// Pro X Phase 1 — the universal event contract. Every connector (SEC now,
// FDA/IR/halts later) normalizes into this shape before it touches the
// database. This is a discovery-side contract only: nothing here feeds
// the canonical HT Labs engine's scoring. Versioned Pro X intelligence
// packets can now travel with canonical records in shadow mode, but Pro X
// observes and advises; it does not decide eligibility or execute orders.

export type ProxCatalystCategory =
  | "merger_acquisition"
  | "fda_decision"
  | "clinical_results"
  | "offering_dilution"
  | "major_contract"
  | "insider_transaction"
  | "earnings_guidance"
  | "reverse_split"
  | "delisting_compliance"
  | "patent_litigation"
  | "government_award"
  | "unclassified";

export type ProxVerificationState = "unverified" | "verified" | "contradicted";

export type ProxTickerMatchMethod = "cik_lookup" | "ambiguous_unresolved";

export type ProxCandidateTicker = {
  ticker: string;
  entityId: string | null;
  matchConfidence: number; // 0-100
  matchMethod: ProxTickerMatchMethod;
};

export type ProxRawEvent = {
  sourceKey: string; // e.g. "sec_edgar_8k" — must exist in prox_sources
  externalId: string; // dedupe key, e.g. SEC accession number
  formType: string | null;
  headline: string;
  rawDocumentUrl: string;
  filedAt: string | null; // ISO timestamp
  candidateTickers: ProxCandidateTicker[];
  catalystCategory: ProxCatalystCategory;
  materialFacts?: Record<string, unknown>;
};
