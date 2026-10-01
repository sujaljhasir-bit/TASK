# Submission Notes

## What's in this submission
| Part | Where |
|------|-------|
| Day 1 tests (unit + integration) | `task-api/tests/taskService.test.js`, `task-api/tests/routes.test.js` |
| Part A, bug report (9 bugs) | `task-api/BUG_REPORT.md` |
| Part B, fix | BUG 2 (pagination off-by-one) in `taskService.getPaginated` |
| Part C, `PATCH /tasks/:id/assign` | `routes/tasks.js`, `services/taskService.js`, `utils/validators.js` + tests |

Run: `cd task-api && npm install && npm test` (or `npm run coverage`).

## Coverage
```
All files        | 98.72 % Stmts | 95.5 % Branch | 96.66 % Funcs | 98.6 % Lines
Tests: 73 passed (includes known-bug tests marked with test.failing)
```
Only `app.js` lines 17-18 (`app.listen`) are uncovered, since the server isn't started under test.

## How the tests treat bugs
Tests for open bugs assert the **correct** behaviour and are wrapped in `test.failing`. The suite is green today,
and a fixed bug turns its test red, which prompts removing `.failing`. I preferred this over deleting the tests
or leaving the suite red, because the bugs stay documented *and* regression-guarded. BUG 2 is fixed, so its tests are normal tests.

## Why I fixed the pagination bug
It's the highest-impact bug that is a one-line, low-risk change: every client using `?page=` was silently missing the
first page of data. The other high-severity ones (BUG 1, BUG 5) are also easy, but the brief asks for one.

## Design decisions for `PATCH /tasks/:id/assign`
- **Validation:** `assignee` must be a string, non-empty after trimming, max 100 chars. Otherwise 400.
- **Empty string:** rejected, not treated as "unassign". A client bug sending `""` shouldn't silently wipe an assignment.
  Unassigning should be an explicit action (e.g. `DELETE /tasks/:id/assignee` or allowing `null`).
- **Already assigned:** reassignment overwrites and returns 200; assigning the same person again is idempotent.
  Rejecting with 409 would force a two-step "unassign then assign" for the common reassign case. The trade-off is
  that two people can overwrite each other silently, which would need an `If-Match`/version check in a real system.
- **Trimming:** the stored value is trimmed so `"Alice"` and `" Alice "` don't become different assignees.
- **404 vs 400 order:** existence is checked first, so an unknown id is always 404 regardless of body.
- **Task shape:** `assignee` is now on every task (`null` when unassigned), so the shape is stable for clients.
- **Not done:** assignee is free text. There is no user model to validate against.

## What I'd test next
- Concurrency/ordering of rapid updates; very large payloads and `limit` values.
- Contract tests for the error response shape across every endpoint.
- Unicode / emoji / HTML in `title` and `assignee`.
- Date edge cases for `overdue` (timezones, due "today", date-only strings).

## What surprised me
- `completeTask` hard-codes `priority: 'medium'`, which looks like a leftover from a copy/paste.
- `GET /tasks` ignores pagination whenever `status` is given.
- The README documents different status names (`pending`, `in-progress`, `completed`) than the code (`todo`, `in_progress`, `done`).
- Validators use truthiness checks, so empty strings bypass them.

## Questions before shipping to production
- Is there meant to be persistence (DB)? In-memory means every deploy/restart loses all data and it can't scale past one instance.
- What is the real status vocabulary, the README's or the code's?
- Is there authentication/authorization? Anyone can read, edit, delete and assign anything.
- Who are valid assignees? Do we need a user model and a way to unassign?
- What are the pagination limits and should the list response include total count / metadata?
- Do we want rate limiting, request logging, and a health-check endpoint?
