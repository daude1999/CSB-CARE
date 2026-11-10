// Deliberate lint error to prove the Quality gate turns red. Reverted in the next commit.
export function ciProof(value: any) {
  var unused = value;
  return 1;
}
