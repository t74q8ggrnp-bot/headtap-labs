export type DueOutcomeReference = {
  member_outcome_id: unknown;
  target_at: unknown;
};

export function selectDueOutcomeMemberIds(
  rows: DueOutcomeReference[],
  limit: number,
) {
  const sorted = [...rows].sort(
    (left, right) =>
      new Date(String(left.target_at)).getTime() -
      new Date(String(right.target_at)).getTime(),
  );
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const row of sorted) {
    const id = String(row.member_outcome_id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= limit) break;
  }
  return ids;
}

export function shouldKeepOutcomeMemberComplete(
  currentStatus: "active" | "complete",
  finalHorizonsComplete: boolean,
) {
  return currentStatus === "complete" || finalHorizonsComplete;
}
