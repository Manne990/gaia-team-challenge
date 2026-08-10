# Dashboard metric contract

`GET /api/dashboard` calculates one organization-scoped snapshot at the
response's `asOf` UTC timestamp. The browser renders that snapshot without
adding records or combining currencies. Refresh requests a new complete
snapshot, so a mutation is reflected once after refresh and cannot be double
counted by client state.

| Metric             | Inclusion rule                                                                                                                                                                                       | Reconciliation target                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Open pipeline      | Non-archived deals whose current status is `open`; amount is the unweighted deal amount                                                                                                              | Deals with `status=open`                                               |
| Stage distribution | The same open deals grouped by their active open stage                                                                                                                                               | Deals with the selected `stageId` and `status=open`                    |
| Won/lost trend     | Current won/lost deals grouped by the UTC month of their latest transition to their current outcome, falling back to `updated_at` for imported/seeded records; six months including the `asOf` month | Deals with matching `status`, `outcomeFrom`, and exclusive `outcomeTo` |
| Recent activity    | Activities from seven 24-hour periods before `asOf` through `asOf`, inclusive                                                                                                                        | Activities with matching inclusive `from` and `to`                     |
| Overdue tasks      | Non-archived, non-completed, non-cancelled tasks due strictly before `asOf`                                                                                                                          | Tasks with an exclusive `dueTo`                                        |
| Upcoming tasks     | The same active task set due from `asOf` inclusive to seven 24-hour periods later, exclusive                                                                                                         | Tasks with `dueFrom` and exclusive `dueTo`                             |
| Deals closing soon | Open, non-archived deals with expected close dates from the `asOf` UTC date inclusive through 30 UTC days later, exclusive                                                                           | Deals with `status=open`, `closeFrom`, and exclusive `closeTo`         |
| Stale accounts     | Non-archived companies with no linked activity during the prior 30 24-hour periods through `asOf`                                                                                                    | Companies with `staleBefore` and `staleThrough`                        |

All monetary totals use integer minor units and are returned separately for
each three-letter currency. An empty organization returns zero counts, empty
currency arrays, and empty series items rather than inferred values.
