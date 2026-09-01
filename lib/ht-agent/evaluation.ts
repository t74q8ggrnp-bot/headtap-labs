export type ChronologicalSample<T> = { observedAt: string; value: T };

export function chronologicalWalkForward<T>(
  samples: ChronologicalSample<T>[],
  minimumTrainingSize: number,
  evaluationSize: number,
) {
  if (minimumTrainingSize < 1 || evaluationSize < 1) {
    throw new Error("Walk-forward windows must be positive.");
  }
  const ordered = [...samples].sort(
    (left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt),
  );
  const folds: Array<{ train: ChronologicalSample<T>[]; evaluate: ChronologicalSample<T>[] }> = [];
  for (let split = minimumTrainingSize; split < ordered.length; split += evaluationSize) {
    const train = ordered.slice(0, split);
    const evaluate = ordered.slice(split, Math.min(ordered.length, split + evaluationSize));
    if (evaluate.length > 0 && Date.parse(train.at(-1)!.observedAt) < Date.parse(evaluate[0].observedAt)) {
      folds.push({ train, evaluate });
    }
  }
  return folds;
}
