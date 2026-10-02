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
      if (name === '@/lib/supabase-pagination') return {
        fetchAllSupabasePages: async (fetchPage) => {
          const rows = [];
          for (let from = 0; ; from += 1000) {
            const result = await fetchPage(from, from + 999);
            if (result.error) throw new Error('無法確認操作結果');
            rows.push(...result.data);
            if (result.data.length < 1000) return rows;
          }
        },
      };
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

test('客服清單聚合跨過第 1,000 筆仍保留較舊未讀對話', async () => {
  const { buildThreads } = loadChatQueries();
  const requested = [];
  const row = (index) => ({ line_user_id: `U${index}`, name: null,
    last_body: `QA_${index}`, last_at: new Date(Date.UTC(2026, 8, 25, 0, 0, index)).toISOString(),
    last_sender: 'patient', unread: index === 1000 ? 1 : 0, blocked: false });
  const firstPage = Array.from({ length: 1000 }, (_, index) => row(index));
  const db = { rpc(name, args) {
    assert.equal(name, 'list_chat_threads');
    assert.equal(args.p_clinic_id, 'clinic');
    const query = { order() { return query; }, range(from, to) {
      requested.push([from, to]);
      return Promise.resolve({ data: from === 0 ? firstPage : [row(1000)], error: null });
    } };
    return query;
  } };
  const threads = await buildThreads(db, 'clinic');
  assert.equal(threads.length, 1001);
  assert.equal(threads.at(-1).lineUserId, 'U1000');
  assert.equal(threads.at(-1).unread, 1);
  assert.deepEqual(requested, [[0, 999], [1000, 1999]]);
});
