/**
 * How many paid checks (about $0.04 each) a passenger may run. Every attempt is recorded as a row
 * BEFORE the paid call and then counted, so server errors and parallel calls count too; the counts
 * passed here already include the caller's own new row. Pure TypeScript, unit-tested.
 */
export type CheckLimits = {
  /** Filmed clips: per trip request, per passenger in 24 h, and for everyone in 24 h. */
  perRequest: number;
  perUserPerDay: number;
  totalPerDay: number;
  /** Demo sample clips: per demo account in 24 h, and for all demo accounts in 24 h. */
  demoPerAccount: number;
  demoTotal: number;
};

export const DEFAULT_LIMITS: CheckLimits = { perRequest: 6, perUserPerDay: 30, totalPerDay: 1000, demoPerAccount: 60, demoTotal: 300 };

export type AttemptCounts =
  | { demo: true; own: number; total: number }
  | { demo: false; request: number; own: number; total: number };

export function attemptAllowed(counts: AttemptCounts, limits: CheckLimits = DEFAULT_LIMITS): boolean {
  if (counts.demo) return counts.own <= limits.demoPerAccount && counts.total <= limits.demoTotal;
  return counts.request <= limits.perRequest && counts.own <= limits.perUserPerDay && counts.total <= limits.totalPerDay;
}
