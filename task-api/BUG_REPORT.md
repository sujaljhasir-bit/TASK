# Bug Report

Every bug below was found by writing a test that asserts the *correct* behaviour. Tests for open bugs use
Jest's `test.failing`, so the suite stays green while the bug exists and turns red when someone fixes it
(the cue to remove `.failing`). Search the tests for `BUG n` to find the matching test.

Status: **BUG 2 is fixed** (Part B). The rest are documented with a proposed fix but left open on purpose.

| # | Severity | Where | Summary | Status |
|---|----------|-------|---------|--------|
| 1 | High | `taskService.getByStatus` | Status filter is a substring match | Open |
| 2 | High | `taskService.getPaginated` | Page 1 skips the first page of results | **Fixed** |
| 3 | Medium | `taskService.completeTask` | Completing a task resets priority to `medium` | Open |
| 4 | Low | `taskService.completeTask` | Re-completing overwrites `completedAt` | Open |
| 5 | High | `taskService.update` | Mass assignment: `id`, `createdAt`, `completedAt` can be overwritten via PUT | Open |
| 6 | Medium | `routes/tasks.js` GET `/` | No validation of `page` / `limit` | Open |
| 7 | Medium | `taskService.update` | PUT `status: "done"` doesn't set `completedAt` | Open |
| 8 | Low | `app.js` error handler | Malformed JSON returns 500 instead of 400 | Open |
| 9 | Low | `utils/validators.js` | Empty-string `status`/`priority`/`dueDate` skip validation | Open |

---

## BUG 1: status filter uses substring match
- **Expected:** `GET /tasks?status=todo` returns tasks whose status is exactly `todo`; an unknown/partial value returns `[]` (or 400).
- **Actual:** `?status=do` returns every `todo` **and** `done` task.
- **Where / why:** `taskService.js` `getByStatus` uses `t.status.includes(status)`. `String.prototype.includes` is a substring check, not equality.
- **Found by:** the test `partial status "do" must not match anything`.
- **Fix:** `tasks.filter((t) => t.status === status)`. Optionally validate `status` in the route and return 400 for values outside `todo | in_progress | done`.

## BUG 2: pagination skips the first page (FIXED)
- **Expected:** `?page=1&limit=2` returns items 1-2; `page=2` returns items 3-4.
- **Actual:** `page=1` returned items 3-4, and the first `limit` items were unreachable through pagination.
- **Where / why:** `taskService.js` `getPaginated` computed `offset = page * limit`. The route defaults `page` to 1, i.e. pages are 1-indexed, so the offset must be `(page - 1) * limit`.
- **Found by:** seeding 5 tasks and asking for page 1; the result started at `t3`.
- **Fix (applied):** `const offset = (page - 1) * limit;`. The related tests no longer use `.failing`.

## BUG 3: completing a task resets priority
- **Expected:** `PATCH /:id/complete` changes only `status` and `completedAt`.
- **Actual:** a `high` priority task comes back as `medium`.
- **Where / why:** `completeTask` builds `{ ...task, priority: 'medium', status: 'done', ... }`. The hard-coded `priority: 'medium'` is a stray line that destroys user data.
- **Found by:** creating a `high` task, completing it, asserting priority is unchanged.
- **Fix:** delete the `priority: 'medium'` line.

## BUG 4: completing twice overwrites `completedAt`
- **Expected:** completing an already-done task is idempotent (keeps the original timestamp) or is rejected with 409.
- **Actual:** every call stamps a new `completedAt`, so the real completion time is lost.
- **Where / why:** `completeTask` doesn't check `task.status === 'done'` before writing.
- **Found by:** completing a task twice with a fake clock 60s apart.
- **Fix:** `if (task.status === 'done') return task;` (idempotent) near the top of `completeTask`.

## BUG 5: mass assignment through PUT
- **Expected:** clients can change only user-editable fields (`title`, `description`, `status`, `priority`, `dueDate`).
- **Actual:** `PUT /tasks/:id {"id":"x","createdAt":"2000-01-01"}` rewrites `id` and `createdAt` (and `completedAt`, and any arbitrary extra keys get stored on the task).
- **Where / why:** `update` does `{ ...tasks[index], ...fields }` with the raw request body, and `validateUpdateTask` only checks known keys, it never strips unknown ones.
- **Found by:** reviewing `update` and then asserting `id`/`createdAt` survive an update.
- **Fix:** whitelist the editable fields before merging (pick `title, description, status, priority, dueDate`).

## BUG 6: `page` / `limit` not validated
- **Expected:** non-positive or non-numeric values are rejected with 400 (or clamped), and `limit` has an upper bound.
- **Actual:** `page=-1` produces a negative offset, so `slice` returns items from the *end* of the array; `limit=-1` similarly returns odd slices; `limit=100000` is allowed; `limit=0` silently becomes 10 because `parseInt(0) || 10`.
- **Where / why:** `routes/tasks.js` GET `/` uses `parseInt(x) || default` with no range check. Related: when `status` is present the pagination params are ignored entirely, so `?status=todo&page=2` can't paginate.
- **Found by:** probing odd query values while writing pagination tests.
- **Fix:** parse, require `page >= 1` and `1 <= limit <= 100`, else 400; apply pagination after filtering.

## BUG 7: PUT to `done` doesn't set `completedAt`
- **Expected:** `status: "done"` always has a `completedAt`, and leaving `done` clears it.
- **Actual:** `PUT {status:"done"}` leaves `completedAt: null`, so a task can be "done" with no completion time (and the reverse after moving back to `todo`).
- **Where / why:** `completedAt` is only managed in `completeTask`; `update` is a plain merge.
- **Found by:** manual probe of PUT, then a test.
- **Fix:** derive `completedAt` from `status` inside `update` (or route all status changes through one function).

## BUG 8: malformed JSON returns 500
- **Expected:** `400 Bad Request` for a syntactically invalid body.
- **Actual:** `500 Internal server error`, plus a stack trace in the logs.
- **Where / why:** the error middleware in `app.js` always sends 500 and ignores `err.status` / `err.statusCode` (body-parser sets 400).
- **Found by:** sending `{bad` to POST `/tasks`.
- **Fix:** `res.status(err.status || 500)`, and only hide the message when status >= 500.

## BUG 9: empty strings skip enum validation
- **Expected:** `status: ""` is a 400.
- **Actual:** it passes and is stored, giving a task whose status matches no bucket in `/stats` (so it is counted nowhere).
- **Where / why:** `validators.js` guards with `if (body.status && ...)`; `""` is falsy so the check is skipped. Same pattern for `priority` and `dueDate`.
- **Found by:** reading the validators, then PUT with `status: ""`.
- **Fix:** use `body.status !== undefined && ...` in both validators.

---

## Documentation inconsistency (not a code bug)
`README.md` lists statuses as `pending | in-progress | completed`, but the code and `ASSIGNMENT.md` use `todo | in_progress | done`. The code is the source of truth and the tests follow it. The README example `?status=pending` returns 400 on create and an empty list on filter.
