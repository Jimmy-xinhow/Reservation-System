import assert from "node:assert/strict";
import test from "node:test";
import { verifyStorageBuckets } from "./provision-storage-buckets.mjs";

function fakeStorage(initial = {}) {
  const buckets = new Map(Object.entries(initial));
  const created = [];
  return {
    buckets,
    created,
    async getBucket(id) {
      return buckets.has(id)
        ? { data: { id, public: buckets.get(id) }, error: null }
        : { data: null, error: { statusCode: "404", message: "Bucket not found" } };
    },
    async createBucket(id, options) {
      created.push({ id, options });
      buckets.set(id, options.public);
      return { data: { name: id }, error: null };
    },
  };
}

test("read-only check reports both missing buckets without mutation", async () => {
  const storage = fakeStorage();
  const result = await verifyStorageBuckets(storage);
  assert.deepEqual(result.map((row) => row.status), ["missing", "missing"]);
  assert.equal(storage.created.length, 0);
});

test("apply creates public brand media and private customer media, then remains idempotent", async () => {
  const storage = fakeStorage();
  const first = await verifyStorageBuckets(storage, { apply: true });
  assert.deepEqual(first.map((row) => row.status), ["created", "created"]);
  assert.deepEqual(storage.created.map((row) => [row.id, row.options.public]), [["line-media", true], ["customer-media", false]]);
  assert.equal(storage.created[0].options.fileSizeLimit, 5 * 1024 * 1024);
  const second = await verifyStorageBuckets(storage, { apply: true });
  assert.deepEqual(second.map((row) => row.status), ["ready", "ready"]);
  assert.equal(storage.created.length, 2);
});

test("mismatched visibility fails closed without rewriting an existing bucket", async () => {
  const storage = fakeStorage({ "line-media": false, "customer-media": false });
  await assert.rejects(verifyStorageBuckets(storage, { apply: true }), /公開性設定與產品用途不符/);
  assert.equal(storage.created.length, 0);
});

test("unexpected read failure cannot create a bucket", async () => {
  const storage = fakeStorage();
  storage.getBucket = async () => ({ data: null, error: { statusCode: "500", message: "backend unavailable" } });
  await assert.rejects(verifyStorageBuckets(storage, { apply: true }), /無法讀取/);
  assert.equal(storage.created.length, 0);
});
