export function normalizeKnowledgeMapAnswer(answer: string): string {
  return answer.replace(
    /root\(\(((?:[^()]|\([^)]*\))*)\)\)/g,
    (_, inner) => "root((" + inner.replace(/\([^)]*\)/g, "") + "))",
  );
}
