/** Editable display default, NOT fill/accounting authority. The ledger uses
 * exact decimal arithmetic and fresh provider quotes independently. */
export function suggestedCryptoPaperLimit(reference:number,side:'buy'|'sell') {
  if(!Number.isFinite(reference)||reference<=0) return '';
  const value=reference*(side==='buy'?1.005:.995);
  const precision=Math.min(12,Math.max(2,7-Math.floor(Math.log10(value))));
  return value.toFixed(precision).replace(/0+$/,'').replace(/\.$/,'');
}
