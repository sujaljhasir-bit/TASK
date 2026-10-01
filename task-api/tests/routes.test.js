
const request = require('supertest');
const app = require('../src/app');
const service = require('../src/services/taskService');

beforeEach(() => service._reset());

const make = async (body = {}) => (await request(app).post('/tasks').send({ title: 'Task', ...body })).body;

describe('POST /tasks', () => {
  test('creates a task (201) with defaults', async () => {
    const res = await request(app).post('/tasks').send({ title: 'Write tests' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: 'Write tests', status: 'todo', priority: 'medium', completedAt: null });
    expect(res.body.id).toBeDefined();
  });

  test.each([
    ['missing title', {}],
    ['empty title', { title: '' }],
    ['whitespace title', { title: '   ' }],
    ['non-string title', { title: 123 }],
    ['invalid status', { title: 'x', status: 'pending' }],
    ['invalid priority', { title: 'x', priority: 'urgent' }],
    ['invalid dueDate', { title: 'x', dueDate: 'not-a-date' }],
  ])('rejects %s with 400', async (_name, body) => {
    const res = await request(app).post('/tasks').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual(expect.any(String));
  });

  // BUG 8: body-parser throws a 400 error for bad JSON, but the catch-all handler in app.js
  // ignores err.status and always answers 500.
  test.failing('malformed JSON returns 400, not 500', async () => {
    const res = await request(app).post('/tasks').set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
  });
});

describe('GET /tasks', () => {
  test('returns an empty array when there are no tasks', async () => {
    const res = await request(app).get('/tasks');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('returns all tasks', async () => {
    await make({ title: 'a' });
    await make({ title: 'b' });
    const res = await request(app).get('/tasks');
    expect(res.body).toHaveLength(2);
  });

  test('filters by exact status', async () => {
    await make({ title: 'a', status: 'todo' });
    await make({ title: 'b', status: 'done' });
    const res = await request(app).get('/tasks?status=done');
    expect(res.body.map((t) => t.title)).toEqual(['b']);
  });

  test.failing('partial status "do" must not match anything (BUG 1: substring match)', async () => {
    await make({ title: 'a', status: 'todo' });
    await make({ title: 'b', status: 'done' });
    const res = await request(app).get('/tasks?status=do');
    expect(res.body).toEqual([]);
  });

  describe('pagination', () => {
    beforeEach(async () => {
      for (let i = 1; i <= 5; i++) await make({ title: `t${i}` });
    });

    // BUG 2 (FIXED): page 1 used to skip the first page of results.
    test('page=1&limit=2 returns the first two tasks', async () => {
      const res = await request(app).get('/tasks?page=1&limit=2');
      expect(res.body.map((t) => t.title)).toEqual(['t1', 't2']);
    });

    test('page=2&limit=2 returns the 3rd and 4th tasks', async () => {
      const res = await request(app).get('/tasks?page=2&limit=2');
      expect(res.body.map((t) => t.title)).toEqual(['t3', 't4']);
    });

    test('page past the end returns an empty array', async () => {
      const res = await request(app).get('/tasks?page=50&limit=2');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    // BUG 6: nonsense values are not validated (page=-1 -> negative slice offset).
    test.failing('negative page is rejected with 400', async () => {
      const res = await request(app).get('/tasks?page=-1&limit=2');
      expect(res.status).toBe(400);
    });
  });
});

describe('PUT /tasks/:id', () => {
  test('updates a task', async () => {
    const t = await make();
    const res = await request(app).put(`/tasks/${t.id}`).send({ title: 'New', priority: 'high' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: t.id, title: 'New', priority: 'high' });
  });

  test('404 for unknown id', async () => {
    const res = await request(app).put('/tasks/nope').send({ title: 'x' });
    expect(res.status).toBe(404);
  });

  test.each([
    ['empty title', { title: '' }],
    ['invalid status', { status: 'bogus' }],
    ['invalid priority', { priority: 'bogus' }],
    ['invalid dueDate', { dueDate: 'bogus' }],
  ])('400 for %s', async (_n, body) => {
    const t = await make();
    const res = await request(app).put(`/tasks/${t.id}`).send(body);
    expect(res.status).toBe(400);
  });

  // BUG 5: the body is spread blindly over the task (mass assignment).
  test.failing('cannot overwrite id / createdAt via the body', async () => {
    const t = await make();
    const res = await request(app).put(`/tasks/${t.id}`).send({ id: 'hacked', createdAt: '2000-01-01T00:00:00.000Z' });
    expect(res.body.id).toBe(t.id);
    expect(res.body.createdAt).toBe(t.createdAt);
  });
});

describe('PUT /tasks/:id - status/completedAt consistency and empty enums', () => {
  // BUG 7: PUT can set status=done without setting completedAt, so stats and data disagree.
  test.failing('moving a task to done via PUT sets completedAt', async () => {
    const t = await make();
    const res = await request(app).put(`/tasks/${t.id}`).send({ status: 'done' });
    expect(res.body.completedAt).not.toBeNull();
  });

  // BUG 9: validators use `if (body.status && ...)`, so '' (falsy) skips validation entirely.
  test.failing('empty-string status is rejected with 400', async () => {
    const t = await make();
    expect((await request(app).put(`/tasks/${t.id}`).send({ status: '' })).status).toBe(400);
  });
});

describe('DELETE /tasks/:id', () => {
  test('deletes and returns 204', async () => {
    const t = await make();
    const res = await request(app).delete(`/tasks/${t.id}`);
    expect(res.status).toBe(204);
    expect((await request(app).get('/tasks')).body).toHaveLength(0);
  });

  test('404 for unknown id', async () => {
    expect((await request(app).delete('/tasks/nope')).status).toBe(404);
  });
});

describe('PATCH /tasks/:id/complete', () => {
  test('marks the task done with completedAt', async () => {
    const t = await make();
    const res = await request(app).patch(`/tasks/${t.id}/complete`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('done');
    expect(res.body.completedAt).not.toBeNull();
  });

  test('404 for unknown id', async () => {
    expect((await request(app).patch('/tasks/nope/complete')).status).toBe(404);
  });

  // BUG 3: priority is reset to "medium".
  test.failing('keeps the original priority', async () => {
    const t = await make({ priority: 'high' });
    const res = await request(app).patch(`/tasks/${t.id}/complete`);
    expect(res.body.priority).toBe('high');
  });
});

describe('GET /tasks/stats', () => {
  test('returns counts by status and overdue count', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    await make({ status: 'todo', dueDate: past });
    await make({ status: 'in_progress' });
    await make({ status: 'done', dueDate: past });
    const res = await request(app).get('/tasks/stats');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ todo: 1, in_progress: 1, done: 1, overdue: 1 });
  });

  test('is not shadowed by /:id (route order)', async () => {
    expect((await request(app).get('/tasks/stats')).body).toHaveProperty('overdue');
  });
});

describe('PATCH /tasks/:id/assign', () => {
  const assign = (id, body) => request(app).patch(`/tasks/${id}/assign`).send(body);

  test('assigns a task and returns the updated task', async () => {
    const t = await make();
    const res = await assign(t.id, { assignee: 'Alice' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: t.id, assignee: 'Alice' });
    // persisted, not just echoed
    const list = (await request(app).get('/tasks')).body;
    expect(list[0].assignee).toBe('Alice');
  });

  test('trims surrounding whitespace', async () => {
    const t = await make();
    expect((await assign(t.id, { assignee: '  Bob  ' })).body.assignee).toBe('Bob');
  });

  test('404 when the task does not exist', async () => {
    expect((await assign('nope', { assignee: 'Alice' })).status).toBe(404);
  });

  test.each([
    ['empty string', { assignee: '' }],
    ['whitespace only', { assignee: '   ' }],
    ['missing field', {}],
    ['number', { assignee: 42 }],
    ['null', { assignee: null }],
    ['array', { assignee: ['Alice'] }],
    ['too long (>100 chars)', { assignee: 'x'.repeat(101) }],
  ])('400 for %s', async (_n, body) => {
    const t = await make();
    const res = await assign(t.id, body);
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual(expect.any(String));
  });

  test('unknown id with an invalid body returns 404 (existence is checked before the body)', async () => {
    expect((await assign('nope', { assignee: '' })).status).toBe(404);
  });

  test('re-assigning an already-assigned task overwrites the assignee (design decision)', async () => {
    const t = await make();
    await assign(t.id, { assignee: 'Alice' });
    const res = await assign(t.id, { assignee: 'Bob' });
    expect(res.status).toBe(200);
    expect(res.body.assignee).toBe('Bob');
  });

  test('assigning the same person twice is idempotent', async () => {
    const t = await make();
    await assign(t.id, { assignee: 'Alice' });
    const res = await assign(t.id, { assignee: 'Alice' });
    expect(res.status).toBe(200);
    expect(res.body.assignee).toBe('Alice');
  });

  test('does not change any other field', async () => {
    const t = await make({ priority: 'high', status: 'in_progress' });
    const res = await assign(t.id, { assignee: 'Alice' });
    expect(res.body).toMatchObject({ priority: 'high', status: 'in_progress', title: t.title });
  });
});
