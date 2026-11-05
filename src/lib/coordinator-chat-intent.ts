/** Safe, deterministic intent detection. Never interprets arbitrary prose as permission to approve or publish. */
export function coordinatorIntent(question: string): "process-plan" | null {
  const q = question.toLowerCase().replace(/[’]/g, "'");
  const action = /\b(process|read|analyse|analyze|extract|digest|prepare|generate|build|create|set up|setup)\b/.test(q);
  const target = /\b(support plan|care plan|service user|care package|intake|uploaded document|uploaded plan|all the records|everything in the system)\b/.test(q);
  return action && target ? "process-plan" : null;
}
