import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function loadChatQueries() {
  const code = ts.transpileModule(fs.readFileSync('lib/chatQueries.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, Buffer, Date, Error,
    require(name) {
      if (name === 'server-only') return {};
      if (name === '@/lib/admin-query') return {
        adminQuery: async (query) => await query,
        adminErrorMessage: () => '無法確認操作結果',
      };
      if (name === '@/lib/delivery-error') return { deliveryError: () => 'internal' };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return exports;
}

function fakeChatDb() {
  const rows = Array.from({ length: 501 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    sender: 'patient', body: `QA_${index}`, read_by_staff: false,
    created_at: new Date(Date.UTC(2026, 8, 25, 0, 0, index)).toISOString(),
  }));
  const readIds = [];
  const seenFilters = [];
  const db = {
    from(table) {
      assert.equal(table, 'chat_messages');
      let operation = 'select';
      let limit = 501;
      let cursorFilter = null;
      let ids = [];
      const query = {
        select() { return query; },
        update() { operation = 'update'; return query; },
        eq() { return query; },
        order() { return query; },
        limit(value) { limit = value; return query; },
        or(value) { cursorFilter = value; seenFilters.push(value); return query; },
        in(_field, value) { ids = value; return query; },
        then(resolve, reject) {
          if (operation === 'update') {
            readIds.push(...ids);
            return Promise.resolve({ error: null }).then(resolve, reject);
          }
          const newestFirst = cursorFilter ? [rows[0]] : [...rows].reverse();
          return Promise.resolve({ data: newestFirst.slice(0, limit), error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  return { db, rows, readIds, seenFilters };
}

test('客服第 501 筆先顯示最新，舊頁可載回，且未顯示訊息仍保持未讀', async () => {
  const { getThreadMessages } = loadChatQueries();
  const { db, rows, readIds, seenFilters } = fakeChatDb();
  const first = await getThreadMessages(db, 'clinic', 'line-user');
  assert.equal(first.messages.length, 500);
  assert.equal(first.messages[0].body, 'QA_1');
  assert.equal(first.messages.at(-1).body, 'QA_500');
  assert.equal(first.hasMore, true);
  assert.equal(readIds.length, 500);
  assert.equal(readIds.includes(rows[0].id), false);

  const older = await getThreadMessages(db, 'clinic', 'line-user', first.nextCursor);
  assert.deepEqual(older.messages.map((message) => message.body), ['QA_0']);
  assert.equal(older.hasMore, false);
  assert.equal(older.nextCursor, null);
  assert.equal(readIds.length, 501);
  assert.ok(seenFilters[0].includes(`id.lt.${rows[1].id}`));
});

test('無效客服游標在查詢資料庫前拒絕', async () => {
  const { getThreadMessages } = loadChatQueries();
  let queried = false;
  await assert.rejects(getThreadMessages({ from() { queried = true; } }, 'clinic', 'line-user', 'invalid'),
    /訊息游標無效/);
  assert.equal(queried, false);
});
