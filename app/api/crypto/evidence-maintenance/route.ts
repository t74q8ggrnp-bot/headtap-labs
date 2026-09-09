import { auditLegacyCryptoBatch, coinApiPilotCronAuthorized } from "@/lib/crypto/coinapi-pilot-server";
import { COINAPI_RESEARCH_RUNTIME } from "@/lib/crypto/coinapi-runtime";
import { withCryptoCapabilities } from "@/lib/crypto/product-capabilities";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/** Archive work has no provider client, trading authority or live publication lock. */
async function getCryptoEvidenceMaintenance(request: Request) {
  const headers = { "Cache-Control":"private, no-store" };
  if (!coinApiPilotCronAuthorized(request)) return Response.json({error:"Unauthorized."},{status:401,headers});
  if (process.env.VERCEL_ENV !== "production") return Response.json({status:"disabled",providerRequests:0},{headers});
  if (!COINAPI_RESEARCH_RUNTIME.archiveMaintenanceAllowed) {
    return Response.json({
      status: "paused",
      reason: COINAPI_RESEARCH_RUNTIME.reason,
      providerRequests: 0,
      databaseAuditRequests: 0,
    }, { headers });
  }
  const result = await auditLegacyCryptoBatch();
  console.info("[crypto-evidence-maintenance]",JSON.stringify(result));
  return Response.json(result,{status:result.ok?200:503,headers});
}

export const GET = withCryptoCapabilities(
  "coinApiEvidenceMaintenanceEnabled",
  getCryptoEvidenceMaintenance,
);
