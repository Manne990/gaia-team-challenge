import { deepStrictEqual } from 'node:assert/strict';

/** Verifies forbidden access and, crucially, no mutation of the foreign record. */
export async function expectForeignWriteToBeRejected({
  attempt,
  readForeignState,
  expectedStatus = 404,
}) {
  const before = await readForeignState();
  const response = await attempt();
  deepStrictEqual(response.status, expectedStatus, 'foreign access must not disclose existence');
  deepStrictEqual(await readForeignState(), before, 'foreign state must remain unchanged');
}
