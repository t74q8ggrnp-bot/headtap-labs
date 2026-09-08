/** Missing/null/unknown counters never stand in for a reconciled ledger. */
export function assessCryptoPaperHealth(input: unknown) {
  const data=input && typeof input==='object' ? input as Record<string,unknown> : null;
  const counters=['accounts','fills','openOrders','overdueOrders','accountMismatches','positionMismatches','orderMismatches','auditMismatches'];
  const counts=Object.fromEntries(counters.map(key=>[key,data?.[key]]));
  const valid=counters.every(key=>typeof counts[key]==='number' && Number.isSafeInteger(counts[key]) && (counts[key] as number)>=0);
  const ok=Boolean(data?.schemaReady===true && data.policyVersion==='crypto-manual-paper-v1' &&
    data.realExecution===false && data.agentAutopilot===false && typeof data.manualPaperEnabled==='boolean' && valid &&
    ['overdueOrders','accountMismatches','positionMismatches','orderMismatches','auditMismatches'].every(key=>counts[key]===0));
  return {name:'crypto_manual_paper_ledger',ok,
    message:ok ? 'Manual crypto paper accounting reconciles; no overdue orders. Market-feed health is checked separately.'
      : 'Manual crypto paper ledger is unavailable or unreconciled. Confirm migration 0040 and inspect accounting/expiry checks.',
    detail:data ? {schemaReady:data.schemaReady,manualPaperEnabled:data.manualPaperEnabled,
      realExecution:data.realExecution,agentAutopilot:data.agentAutopilot,...counts} : {schemaReady:false}};
}
