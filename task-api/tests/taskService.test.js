/**
 * Unit tests for src/services/taskService.js
 *
 * Convention used in this file:
 *  - Normal `test(...)`      -> behaviour that is correct today.
 *  - `test.failing(...)`     -> a KNOWN BUG. The test asserts the CORRECT behaviour and is
 *                               expected to fail against the current code. Jest reports it as
 *                               passing while the bug exists, and will turn RED once someone
 *                               fixes the bug, which is the cue to delete the `.failing`.
 *                               See BUG_REPORT.md for the full write-up of each one.
 */
const service = require('../src/services/taskService');

beforeEach(() => service._reset());

describe('create', () => {
  test('applies defaults and generates id/createdAt', () => {
    const t = service.create({ title: 'A' });
    expect(t).toMatchObject({
      title: 'A',
      description: '',
      status: 'todo',
      priority: 'medium',
      dueDate: null,
      completedAt: null,
      assignee: null,
    });
    expect(typeof t.id).toBe('string');
    expect(Number.isNaN(Date.parse(t.createdAt))).toBe(false);
  });

  test('keeps provided fields and generates unique ids', () => {
    const a = service.create({ title: 'A', priority: 'high', status: 'in_progress' });
    const b = service.create({ title: 'B' });
    expect(a.priority).toBe('high');
    expect(a.status).toBe('in_progress');
    expect(a.id).not.toBe(b.id);
  });
});

describe('getAll / findById', () => {
  test('getAll returns a copy, so mutating the result does not affect the store', () => {
    service.create({ title: 'A' });
    service.getAll().pop();
    expect(service.getAll()).toHaveLength(1);
  });

  test('findById returns the task, or undefined when missing', () => {
    const t = service.create({ title: 'A' });
    expect(service.findById(t.id)).toEqual(t);
    expect(service.findById('nope')).toBeUndefined();
  });
});

describe('getByStatus', () => {
  beforeEach(() => {
    service.create({ title: 'a', status: 'todo' });
    service.create({ title: 'b', status: 'in_progress' });
    service.create({ title: 'c', status: 'done' });
  });

  test('returns only tasks with the exact status', () => {
    expect(service.getByStatus('todo').map((t) => t.title)).toEqual(['a']);
    expect(service.getByStatus('done').map((t) => t.title)).toEqual(['c']);
  });

  test('returns [] when nothing matches', () => {
    expect(service.getByStatus('nonexistent')).toEqual([]);
  });

  // BUG 1: uses String.includes (substring match) instead of strict equality.
  test.failing('does not match partial status strings ("do" must not match todo/done)', () => {
    expect(service.getByStatus('do')).toEqual([]);
  });
});

describe('getPaginated', () => {
  beforeEach(() => {
    for (let i = 1; i <= 5; i++) service.create({ title: `t${i}` });
  });

  // BUG 2 (FIXED): offset used to be page*limit instead of (page-1)*limit, so page 1 skipped the first page.
  test('page 1 returns the first `limit` items', () => {
    expect(service.getPaginated(1, 2).map((t) => t.title)).toEqual(['t1', 't2']);
  });

  test('page 2 returns the next `limit` items', () => {
    expect(service.getPaginated(2, 2).map((t) => t.title)).toEqual(['t3', 't4']);
  });

  test('last partial page returns the remaining items', () => {
    expect(service.getPaginated(3, 2).map((t) => t.title)).toEqual(['t5']);
  });

  test('a page beyond the end returns []', () => {
    expect(service.getPaginated(99, 2)).toEqual([]);
  });
});

describe('getStats', () => {
  test('returns zeros for an empty store', () => {
    expect(service.getStats()).toEqual({ todo: 0, in_progress: 0, done: 0, overdue: 0 });
  });

  test('counts by status', () => {
    service.create({ title: 'a', status: 'todo' });
    service.create({ title: 'b', status: 'todo' });
    service.create({ title: 'c', status: 'in_progress' });
    service.create({ title: 'd', status: 'done' });
    expect(service.getStats()).toMatchObject({ todo: 2, in_progress: 1, done: 1 });
  });

  test('overdue counts past-due tasks that are not done', () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const future = new Date(Date.now() + 86400000).toISOString();
    service.create({ title: 'late', dueDate: past });
    service.create({ title: 'late but done', dueDate: past, status: 'done' });
    service.create({ title: 'not due yet', dueDate: future });
    service.create({ title: 'no due date' });
    expect(service.getStats().overdue).toBe(1);
  });
});

describe('update', () => {
  test('merges fields and persists them', () => {
    const t = service.create({ title: 'A' });
    const updated = service.update(t.id, { title: 'B', priority: 'high' });
    expect(updated).toMatchObject({ id: t.id, title: 'B', priority: 'high' });
    expect(service.findById(t.id).title).toBe('B');
  });

  test('returns null for an unknown id', () => {
    expect(service.update('nope', { title: 'x' })).toBeNull();
  });

  // BUG 5: the whole body is spread over the task, so protected fields can be overwritten.
  test.failing('cannot overwrite id or createdAt', () => {
    const t = service.create({ title: 'A' });
    const updated = service.update(t.id, { id: 'hacked', createdAt: '2000-01-01T00:00:00.000Z' });
    expect(updated.id).toBe(t.id);
    expect(updated.createdAt).toBe(t.createdAt);
  });
});

describe('remove', () => {
  test('removes an existing task and returns true', () => {
    const t = service.create({ title: 'A' });
    expect(service.remove(t.id)).toBe(true);
    expect(service.getAll()).toHaveLength(0);
  });

  test('returns false for an unknown id', () => {
    expect(service.remove('nope')).toBe(false);
  });
});

describe('completeTask', () => {
  test('sets status=done and completedAt', () => {
    const t = service.create({ title: 'A' });
    const done = service.completeTask(t.id);
    expect(done.status).toBe('done');
    expect(Number.isNaN(Date.parse(done.completedAt))).toBe(false);
    expect(service.findById(t.id).status).toBe('done');
  });

  test('returns null for an unknown id', () => {
    expect(service.completeTask('nope')).toBeNull();
  });

  // BUG 3: completing a task silently resets its priority to "medium".
  test.failing('preserves the existing priority', () => {
    const t = service.create({ title: 'A', priority: 'high' });
    expect(service.completeTask(t.id).priority).toBe('high');
  });

  // BUG 4: completing an already-done task overwrites the original completedAt.
  test.failing('is idempotent: re-completing keeps the original completedAt', () => {
    const t = service.create({ title: 'A' });
    const first = service.completeTask(t.id);
    jest.useFakeTimers().setSystemTime(Date.now() + 60000);
    const second = service.completeTask(t.id);
    jest.useRealTimers();
    expect(second.completedAt).toBe(first.completedAt);
  });
});

describe('assign', () => {
  test('stores the assignee and returns the updated task', () => {
    const t = service.create({ title: 'A' });
    const assigned = service.assign(t.id, 'Alice');
    expect(assigned.assignee).toBe('Alice');
    expect(service.findById(t.id).assignee).toBe('Alice');
  });

  test('returns null for an unknown id', () => {
    expect(service.assign('nope', 'Alice')).toBeNull();
  });

  test('does not touch any other field', () => {
    const t = service.create({ title: 'A', priority: 'high' });
    expect(service.assign(t.id, 'Alice')).toMatchObject({ title: 'A', priority: 'high', status: 'todo' });
  });
});
