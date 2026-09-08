export type HomeInitialOpportunityPayload = {
  opportunities?: unknown[];
  momentumRadar?: unknown[];
  momentumContenders?: unknown[];
};

/**
 * Keep the server-rendered homepage bootstrap intentionally small.
 *
 * The public opportunity API still exposes the complete ranked frame. The
 * browser refreshes that frame after first paint, so serializing scores of
 * full opportunity records into both HTML and the RSC payload only delays the
 * first useful screen. Constructing a new object also prevents internal frame
 * diagnostics such as sourceRun from leaking into the page bootstrap.
 */
export function compactHomeInitialOpportunityPayload(
  payload: HomeInitialOpportunityPayload | null | undefined,
  opportunityLimit: number,
): HomeInitialOpportunityPayload | null {
  if (!payload) return null;

  const safeLimit = Math.max(0, Math.floor(opportunityLimit));

  return {
    opportunities: (payload.opportunities ?? []).slice(0, safeLimit),
    momentumContenders: (payload.momentumContenders ?? []).slice(0, 5),
    momentumRadar: (payload.momentumRadar ?? []).slice(0, 10),
  };
}
