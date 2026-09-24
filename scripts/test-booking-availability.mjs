import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Execute the actual page callback with controlled requests and state setters.
// This tests out-of-order responses without a database or a second implementation.
const text = readFileSync(new URL("../app/book/page.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("page.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
let boundCallback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "loadBound" && node.initializer && ts.isCallExpression(node.initializer)) boundCallback = node.initializer.arguments[0].getText(source);
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "loadAvailability" && node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0].getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(callback, "page availability callback must exist");
assert.ok(boundCallback, "page customer callback must exist");
const captures = ["config", "date", "providerRequired", "doctorId", "serviceId", "visitType", "selectedAddonIds", "api", "setAvailLoading", "setAvailMsg", "setSlots", "setSessions", "setWaitlistSlots", "setWaitlistSessions", "setPickedStart", "setPickedTemplate", "setJoiningWaitlist"];
const { outputText } = ts.transpileModule(`export function create(context) { const { ${captures.join(",")} } = context; return ${callback}; }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { create } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

const selectionSource = readFileSync(new URL("../lib/booking-selection.ts", import.meta.url), "utf8");
const boundModule = ts.transpileModule(`${selectionSource}
export function createBound(context) {
  const { idToken, boundRequest, rebookPatient, api, setBound, setSelectedPatientId, setRebookNotice, setLoadErr } = context;
  return ${boundCallback};
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { createBound } = await import(`data:text/javascript;base64,${Buffer.from(boundModule.outputText).toString("base64")}`);

test("late customer lookup cannot consume a rebooking selection or overwrite the latest family list", async () => {
  const requests = [];
  const state = { selected: "parent" };
  const requested = { current: "child" };
  const run = createBound({
    idToken: "test-token", boundRequest: { current: 0 }, rebookPatient: requested,
    api: () => new Promise((resolve) => requests.push(resolve)),
    setBound: (value) => { state.patients = value; },
    setSelectedPatientId: (update) => { state.selected = update(state.selected); },
    setRebookNotice: (value) => { state.notice = value; },
    setLoadErr: (value) => { state.error = value; },
  });
  const old = run();
  const latest = run();
  requests[0]({ patients: [{ id: "parent" }] });
  await old;
  assert.equal(requested.current, "child");
  assert.equal(state.patients, undefined);
  requests[1]({ patients: [{ id: "parent" }, { id: "child" }] });
  await latest;
  assert.equal(state.selected, "child");
  assert.equal(requested.current, null);
  assert.equal(state.notice, undefined);
  assert.equal(state.error, undefined);
});

function fixture(mode) {
  const state = {};
  const requests = [];
  const context = { config: { booking_mode: mode, services: [{ id: "service" }] }, date: "2026-09-20", providerRequired: true, doctorId: "doctor", serviceId: "service", visitType: "return", selectedAddonIds: [] };
  for (const key of captures.filter((name) => name.startsWith("set"))) context[key] = (value) => { state[key] = value; };
  context.api = (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject }));
  return { state, requests, run: (overrides = {}) => create({ ...context, ...overrides }) };
}

for (const mode of ["time", "number"]) {
  const field = mode === "time" ? "slots" : "sessions";
  const setter = mode === "time" ? "setSlots" : "setSessions";
  test(`${mode}: late old results cannot overwrite a newer date`, async () => {
    const f = fixture(mode);
    const old = new AbortController();
    const first = f.run()(old.signal);
    old.abort();
    const latest = new AbortController();
    const second = f.run({ date: "2026-09-21" })(latest.signal);
    f.requests[1].resolve({ [field]: [{ id: "new" }] });
    await second;
    f.requests[0].resolve({ [field]: [{ id: "old" }] });
    await first;
    assert.deepEqual(f.state[setter], [{ id: "new" }]);
    assert.equal(f.requests[0].options.signal, old.signal);
    assert.equal(f.state.setAvailLoading, false);
  });

  test(`${mode}: old failures cannot clear the current loading state or show an error`, async () => {
    const f = fixture(mode);
    const old = new AbortController();
    const first = f.run()(old.signal);
    old.abort();
    const second = f.run({ date: "2026-09-21" })(new AbortController().signal);
    f.requests[0].reject(new Error("old request failed"));
    await first;
    assert.equal(f.state.setAvailLoading, true);
    assert.equal(f.state.setAvailMsg, null);
    f.requests[1].resolve({ [field]: [] });
    await second;
    assert.equal(f.state.setAvailLoading, false);
    assert.ok(f.state.setAvailMsg);
  });
}

test("clearing a required choice clears stale slot and waitlist selections without a request", async () => {
  for (const override of [{ date: "" }, { doctorId: "" }, { serviceId: "" }]) {
    const f = fixture("time");
    await f.run(override)(new AbortController().signal);
    assert.equal(f.requests.length, 0);
    for (const setter of ["setSlots", "setSessions", "setWaitlistSlots", "setWaitlistSessions"]) assert.deepEqual(f.state[setter], []);
    assert.equal(f.state.setPickedStart, null);
    assert.equal(f.state.setPickedTemplate, null);
    assert.equal(f.state.setJoiningWaitlist, false);
    assert.equal(f.state.setAvailLoading, false);
  }
});

for (const page of ["reschedule", "browser/reschedule"]) {
  const code = readFileSync(new URL(`../app/book/${page}/page.tsx`, import.meta.url), "utf8");
  const ast = ts.createSourceFile("page.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let extracted;
  function find(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "loadAvailability") extracted = node.initializer.arguments[0].getText(ast);
    ts.forEachChild(node, find);
  }
  find(ast);
  assert.ok(extracted);
  const compiled = ts.transpileModule(`export function create(context) {
    const { config, appointment, selectionReady, date, visitType, doctorId, serviceId, api, setAvailabilityLoading, setError, setSlots, setSessions, setPickedStart, setPickedTemplate } = context;
    return ${extracted};
  }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
  const { create: make } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);
  function setup(mode) {
    const state = {}, requests = [];
    const context = { config: { booking_mode: mode }, appointment: { visit_type: "first" }, selectionReady: true, date: "2026-09-20", visitType: "first", doctorId: "doctor", serviceId: "service",
      api: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })) };
    for (const setter of ["setAvailabilityLoading", "setError", "setSlots", "setSessions", "setPickedStart", "setPickedTemplate"]) context[setter] = (value) => { state[setter] = value; };
    return { state, requests, run: (override = {}) => make({ ...context, ...override }) };
  }
  for (const mode of ["time", "number"]) {
    test(`${page} ${mode}: cancelled results and failures cannot overwrite a new date`, async () => {
      const f = setup(mode), old = new AbortController(), failed = new AbortController();
      const first = f.run()(old.signal);
      old.abort();
      const second = f.run()(failed.signal);
      failed.abort();
      const latest = f.run({ date: "2026-09-21" })(new AbortController().signal);
      f.requests[1].reject(new Error("stale failure")); await second;
      assert.equal(f.state.setAvailabilityLoading, true);
      assert.equal(f.state.setError, null);
      const field = mode === "time" ? "slots" : "sessions";
      const setter = mode === "time" ? "setSlots" : "setSessions";
      f.requests[2].resolve({ [field]: [{ id: "latest" }] }); await latest;
      f.requests[0].resolve({ [field]: [{ id: "stale" }] }); await first;
      assert.deepEqual(f.state[setter], [{ id: "latest" }]);
      assert.equal(f.state.setAvailabilityLoading, false);
      assert.equal(f.requests[0].options.signal, old.signal);
    });
  }
  test(`${page}: clearing or invalidating choices clears the previous selection without fetching`, async () => {
    const f = setup("time");
    await f.run({ selectionReady: false })(new AbortController().signal);
    assert.equal(f.requests.length, 0);
    assert.deepEqual(f.state.setSlots, []);
    assert.deepEqual(f.state.setSessions, []);
    assert.equal(f.state.setPickedStart, "");
    assert.equal(f.state.setPickedTemplate, "");
    assert.equal(f.state.setAvailabilityLoading, false);
  });
}

for (const page of ["MyAppointments.tsx", "browser/my/page.tsx"]) {
  const code = readFileSync(new URL(`../app/book/${page}`, import.meta.url), "utf8");
  const ast = ts.createSourceFile("page.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let loader, cancel, waitlist;
  function find(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "load") loader = node.initializer.arguments[0].getText(ast);
    if (ts.isFunctionDeclaration(node) && node.name?.text === "cancel") cancel = node.getText(ast);
    if (ts.isFunctionDeclaration(node) && node.name?.text === "waitlistAction") waitlist = node.getText(ast);
    ts.forEachChild(node, find);
  }
  find(ast);
  assert.ok(loader && cancel && waitlist);
  const errorSource = readFileSync(new URL("../lib/customer-api-error.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(`${errorSource}
export function create(c) {
    const { idToken, token, actionLock, loadRequest, api, safeLocalStorageRemoveMatching, customerTokenKey, tokenKey, setToken, setLoading, setErr, setError, setList, setAppointments, setWaitlists, setProgress, setNotice, setCancelling, setWorking } = c;
    const load = ${loader}; ${cancel} ${waitlist}
    return { cancel, waitlistAction, load };
  }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
  const { create: make, CustomerApiError: PageApiError } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);
  for (const action of ["cancel", "waitlistAction"]) {
    test(`${page} ${action}: lock blocks concurrent writes and refresh failure preserves confirmed outcome`, async () => {
      const pending = [], state = { list: [{ id: "a" }, { id: "b" }], waitlists: [{ id: "a" }] };
      const lock = { current: false };
      const update = (key) => (value) => { state[key] = typeof value === "function" ? value(state[key]) : value; };
      const actions = make({ idToken: "test", token: "test", actionLock: lock, loadRequest: { current: 0 },
        api: (url) => url.endsWith("/my") ? Promise.reject(new Error("refresh unavailable")) : new Promise((resolve, reject) => pending.push({ resolve, reject })),
        setLoading: update("loading"), setErr: update("error"), setError: update("error"), setList: update("list"), setAppointments: update("list"), setWaitlists: update("waitlists"), setProgress: update("progress"), setNotice: update("notice"), setCancelling: update("working"), setWorking: update("working"),
      });
      const first = actions[action]("a", "accept", "patient");
      await actions.cancel("b");
      await actions.waitlistAction("b", "cancel", "patient");
      assert.equal(pending.length, 1);
      pending[0].resolve({}); await first;
      assert.equal(lock.current, false);
      assert.equal(state.working, null);
      assert.equal(state.error, "refresh unavailable");
      assert.ok(state.notice);
      if (action === "cancel") assert.deepEqual(state.list, [{ id: "b" }]);
      else assert.deepEqual(state.waitlists, []);
      const retry = actions.cancel("b");
      assert.equal(pending.length, 2);
      pending[1].reject(new Error("write failed")); await retry;
      assert.equal(lock.current, false);
      assert.equal(state.notice, null);
      assert.equal(state.error, "write failed");
    });
  }
  if (page.startsWith("browser")) {
    test("browser identity errors reopen verification while network errors preserve the current records", async () => {
      for (const status of [401, 403, 500]) {
        const state = { token: "expired", list: [{ id: "a" }], waitlists: [{ id: "w" }] }, removed = [];
        const update = (key) => (value) => { state[key] = value; };
        const actions = make({ idToken: null, token: "expired", actionLock: { current: false }, loadRequest: { current: 0 },
          api: async () => { throw new PageApiError("lookup failed", status); },
          safeLocalStorageRemoveMatching: (...args) => removed.push(args), customerTokenKey: () => "customer:brand", tokenKey: () => "booking:brand",
          setToken: update("token"), setLoading: update("loading"), setError: update("error"), setAppointments: update("list"), setWaitlists: update("waitlists"),
        });
        await actions.load("expired");
        assert.equal(state.loading, false);
        assert.equal(state.error, "lookup failed");
        if (status === 500) {
          assert.equal(state.token, "expired");
          assert.deepEqual(state.list, [{ id: "a" }]);
          assert.equal(removed.length, 0);
        } else {
          assert.equal(state.token, null);
          assert.equal(state.list, null);
          assert.deepEqual(state.waitlists, []);
          assert.equal(removed[0][1], "expired");
        }
      }
    });
  }

}

{
  const code = readFileSync(new URL("../app/register/pay/page.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("page.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let payCode;
  function find(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "pay") payCode = node.getText(ast);
    ts.forEachChild(node, find);
  }
  find(ast); assert.ok(payCode);
  const helpers = readFileSync(new URL("../lib/registration-storage.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(`${helpers}
    export function create(c) {
      const { paymentLock, registrationId, token, browserToken, clinicScope, validRegistrationId, setError, setSubmitting, readApi, safeLocalStorageGet, safeLocalStorageSet, document } = c;
      ${payCode} return pay;
    }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
  const { create } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);
  test("registration payment ignores double clicks and saves no credential before server acceptance", async () => {
    const pending = [], writes = [], state = {}, lock = { current: false };
    let submits = 0;
    const pay = create({ paymentLock: lock, registrationId: "id", token: "new", browserToken: "", clinicScope: "?clinic_slug=a", validRegistrationId: () => true,
      setError: (value) => { state.error = value; }, setSubmitting: (value) => { state.submitting = value; },
      readApi: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
      safeLocalStorageGet: () => '{"registration_no":"R001","checkin_token":"old"}', safeLocalStorageSet: (value) => writes.push(value),
      document: { createElement: () => ({ style: {}, appendChild() {}, submit() { submits += 1; } }), body: { appendChild() {} } },
    });
    const first = pay(); await pay();
    assert.equal(pending.length, 1); assert.equal(writes.length, 0);
    pending[0].reject(new Error("invalid credential")); await first;
    assert.equal(lock.current, false); assert.equal(writes.length, 0);
    const second = pay(); await pay(); assert.equal(pending.length, 2);
    pending[1].resolve({ form: { action: "https://payment.example", fields: {} } }); await second;
    assert.equal(submits, 1); assert.equal(lock.current, true);
    assert.deepEqual(JSON.parse(writes[0][0][1]), { registration_no: "R001", checkin_token: "new" });
  });
}

{
  const code = readFileSync(new URL("../app/register/my/page.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("page.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let submitCode;
  function find(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "submit") submitCode = node.getText(ast);
    ts.forEachChild(node, find);
  }
  find(ast); assert.ok(submitCode);
  const compiled = ts.transpileModule(`export function create(c) {
    const { queryController, registrationNo, phone, setLoading, setError, setResult, fetch, window } = c;
    ${submitCode} return submit;
  }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
  const { create } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);
  test("registration lookup keeps credentials out of URL and ignores the cancelled query", async () => {
    const pending = [], state = {}, queryController = { current: null };
    const context = { queryController, registrationNo: " R001 ", phone: " 0912345678 ", window: { location: { search: "?clinic_slug=brand&phone=do-not-copy" } },
      setLoading: (v) => { state.loading = v; }, setError: (v) => { state.error = v; }, setResult: (v) => { state.result = v; },
      fetch: (url, options) => new Promise((resolve) => pending.push({ url, options, resolve })),
    };
    const first = create(context)({ preventDefault() {} });
    const latest = create({ ...context, registrationNo: "R002" })({ preventDefault() {} });
    assert.equal(pending[0].url, "/api/registration/my?clinic_slug=brand");
    assert.equal(pending[0].options.method, "POST");
    assert.equal(pending[0].options.cache, "no-store");
    assert.deepEqual(JSON.parse(pending[0].options.body), { registration_no: "R001", phone: "0912345678" });
    pending[0].resolve({ ok: true, json: async () => ({ ok: true, data: { id: "old" } }) }); await first;
    assert.equal(state.loading, true); assert.equal(state.result, null);
    pending[1].resolve({ ok: true, json: async () => ({ ok: true, data: { id: "latest" } }) }); await latest;
    assert.deepEqual(state.result, { id: "latest" }); assert.equal(state.loading, false);
  });
}
{
  const code = readFileSync(new URL("../app/api/registration/my/route.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("route.ts", code, ts.ScriptTarget.Latest, true);
  const functions = ast.statements.filter(ts.isFunctionDeclaration).map((node) => node.getText(ast).replace(/^export /, "")).join("\n");
  const compiled = ts.transpileModule(`export function create(c) {
    const { rateLimitResponse, fail, ok, createServiceClient, resolvePublicClinicId } = c;
    ${functions} return { GET, POST };
  }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
  const { create } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);
  test("registration lookup rejects GET and requires typed POST credentials within resolved brand", async () => {
    const filters = [], result = { registration_no: "R001" };
    const query = { select() { return this; }, eq(key, value) { filters.push([key, value]); return this; }, async maybeSingle() { return { data: result, error: null }; } };
    const routes = create({ rateLimitResponse: async () => null,
      fail: (error, status = 400) => ({ error, status, headers: new Headers() }), ok: (data) => ({ data, headers: new Headers() }),
      createServiceClient: () => ({ from: () => query }), resolvePublicClinicId: async () => "brand-a",
    });
    const get = await routes.GET(); assert.equal(get.status, 405); assert.equal(get.headers.get("Allow"), "POST"); assert.equal(filters.length, 0);
    const invalid = await routes.POST({ json: async () => ({ registration_no: 123, phone: ["0912345678"] }) });
    assert.equal(invalid.status, 400); assert.equal(filters.length, 0);
    const response = await routes.POST({ json: async () => ({ registration_no: " r001 ", phone: " 0912345678 " }) });
    assert.deepEqual(filters, [["clinic_id", "brand-a"], ["registration_no", "R001"], ["phone", "0912345678"]]);
    assert.equal(response.headers.get("Cache-Control"), "no-store"); assert.deepEqual(response.data, result);
  });
}

{
  const code = readFileSync(new URL("../app/register/cancel/page.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("page.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let cancelCode, submitCode;
  function find(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "cancel") cancelCode = node.getText(ast);
    if (ts.isFunctionDeclaration(node) && node.name?.text === "submit") submitCode = node.getText(ast);
    ts.forEachChild(node, find);
  }
  find(ast); assert.ok(cancelCode && submitCode);
  const compiled = ts.transpileModule(`export function create(c) {
    const { fetch, token, scopeSuffix, actionLock, setSubmitting, setMessage, setError, setToken } = c;
    ${cancelCode} ${submitCode} return { cancel, submit };
  }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
  const { create } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);
  test("registration cancellation requires explicit cancelled status and successful HTTP response", async () => {
    for (const response of [
      { ok: true, json: async () => ({ ok: true, data: { registration_status: "pending" } }) },
      { ok: true, json: async () => ({ ok: true }) },
      { ok: false, json: async () => ({ ok: true, data: { registration_status: "cancelled" } }) },
      { ok: true, json: async () => { throw new Error("invalid json"); } },
    ]) await assert.rejects(create({ fetch: async () => response }).cancel("secret", "?clinic_slug=a"));
    assert.equal(await create({ fetch: async () => ({ ok: true, json: async () => ({ ok: true, data: { registration_status: "cancelled" } }) }) }).cancel("secret", ""), "已取消報名");
  });
  test("registration cancellation blocks double clicks, keeps failed credentials and clears only confirmed success", async () => {
    const pending = [], state = { token: "secret" }, lock = { current: false };
    const actions = create({ token: "secret", scopeSuffix: "?clinic_slug=a", actionLock: lock,
      fetch: (url, init) => new Promise((resolve, reject) => pending.push({ url, init, resolve, reject })),
      setToken: (v) => { state.token = v; }, setMessage: (v) => { state.message = v; }, setError: (v) => { state.error = v; }, setSubmitting: (v) => { state.busy = v; },
    });
    const first = actions.submit(); await actions.submit(); assert.equal(pending.length, 1);
    assert.equal(pending[0].url, "/api/registration/cancel?clinic_slug=a");
    assert.deepEqual(JSON.parse(pending[0].init.body), { token: "secret" });
    pending[0].reject(new Error("network")); await first;
    assert.equal(state.token, "secret"); assert.equal(lock.current, false); assert.equal(state.message, null);
    const retry = actions.submit();
    pending[1].resolve({ ok: true, json: async () => ({ ok: true, data: { registration_status: "cancelled" } }) }); await retry;
    assert.equal(state.token, ""); assert.equal(state.message, "已取消報名"); assert.equal(state.busy, false); assert.equal(lock.current, false);
  });
}

{
  const code = readFileSync(new URL("../app/my/page.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("page.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let loader, cancel;
  function find(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "load") loader = node.initializer.arguments[0].getText(ast);
    if (ts.isFunctionDeclaration(node) && node.name?.text === "cancelRegistration") cancel = node.getText(ast);
    ts.forEachChild(node, find);
  }
  find(ast); assert.ok(loader && cancel);
  const helper = readFileSync(new URL("../lib/customer-api-error.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(`${helper}
    export function create(c) {
      const { cancelPending, setCancelPending, loadRequest, actionLock, fetch, scopeSuffix, tokenKey, storedToken, safeLocalStorageSet, safeLocalStorageRemoveMatching, setData, setLoading, setError, setNeedsVerification, setActionMessage, setActionError, setActing, window } = c;
      const load = ${loader}; ${cancel} return { load, cancelRegistration };
    }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
  const { create } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);
  function fixture(fetch) {
    const state = { data: { registrations: [{ id: "a", status: "pending", payment_status: "pending" }] } }, removed = [];
    const context = { cancelPending: "a", setCancelPending: value => { state.cancelPending = value; }, fetch, loadRequest: { current: 0 }, actionLock: { current: false }, scopeSuffix: () => "?clinic_slug=a", tokenKey: () => "customer_browser_token:a", storedToken: () => "session", safeLocalStorageSet() {}, safeLocalStorageRemoveMatching: (...args) => removed.push(args), window: { confirm: () => true } };
    for (const [setter, key] of Object.entries({ setData: "data", setLoading: "loading", setError: "error", setNeedsVerification: "verify", setActionMessage: "message", setActionError: "actionError", setActing: "acting" })) context[setter] = (value) => { state[key] = typeof value === "function" ? value(state[key]) : value; };
    return { state, removed, context, actions: create(context) };
  }
  test("customer portal preserves records on 500 but removes unauthorized identity on 401 or 403", async () => {
    for (const status of [500, 401, 403]) {
      const f = fixture(async () => ({ ok: false, status, json: async () => ({ ok: false, error: "failed" }) }));
      await f.actions.load("session");
      assert.equal(f.state.loading, false);
      if (status === 500) { assert.ok(f.state.data); assert.equal(f.removed.length, 0); }
      else { assert.equal(f.state.data, null); assert.equal(f.state.verify, true); assert.equal(f.removed[0][1], "session"); }
    }
  });
  test("customer portal cancellation is locked and retains confirmed cancellation when refresh fails", async () => {
    const pending = [];
    const f = fixture((url) => url.includes("registration-action") ? new Promise((resolve) => pending.push(resolve)) : Promise.reject(new Error("refresh failed")));
    await f.actions.cancelRegistration("other"); assert.equal(pending.length, 0);
    const first = f.actions.cancelRegistration("a");
    await f.actions.cancelRegistration("a"); assert.equal(pending.length, 1);
    pending[0]({ ok: true, json: async () => ({ ok: true, data: { registration_status: "cancelled" } }) }); await first;
    assert.equal(f.state.data.registrations[0].status, "cancelled");
    assert.equal(f.state.cancelPending, null); assert.ok(f.state.message); assert.equal(f.state.error, "refresh failed");
    assert.equal(f.state.acting, null); assert.equal(f.context.actionLock.current, false);
  });
}

{
  const code = readFileSync(new URL("../app/membership/page.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("page.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let loader, clear, purchase;
  function find(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "loadPortal") loader = node.initializer.arguments[0].getText(ast);
    if (ts.isFunctionDeclaration(node) && node.name?.text === "clearIdentity") clear = node.getText(ast);
    if (ts.isFunctionDeclaration(node) && node.name?.text === "purchase") purchase = node.getText(ast);
    ts.forEachChild(node, find);
  }
  find(ast); assert.ok(loader && clear && purchase);
  const helper = readFileSync(new URL("../lib/customer-api-error.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(`${helper}
    export function create(c) {
      const { loadRequest, lookupBusy, purchaseLock, token, verified, fetch, brandedPath, customerTokenKey, safeLocalStorageRemoveMatching, trackFunnelEvent, window, document, setToken, setVerified, setMemberships, setPlans, setError, setLoading, setName, setPhone, setBirthday, setBuying } = c;
      const loadPortal = ${loader}; ${clear} ${purchase} return { loadPortal, clearIdentity, purchase };
    }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
  const { create } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);
  function fixture(fetch) {
    const state = { memberships: ["existing"], verified: true }, removed = [];
    const c = { fetch, token: "session", verified: true, loadRequest: { current: 0 }, lookupBusy: { current: false }, purchaseLock: { current: false }, brandedPath: (p) => p, customerTokenKey: () => "customer_browser_token:a", safeLocalStorageRemoveMatching: (...a) => removed.push(a), trackFunnelEvent() {}, window: { localStorage: { setItem() {} } }, document: { createElement: () => ({ style: {}, appendChild() {}, submit() {} }), body: { appendChild() {} } } };
    for (const name of ["Token", "Verified", "Memberships", "Plans", "Error", "Loading", "Name", "Phone", "Birthday", "Buying"]) c[`set${name}`] = (v) => { state[name[0].toLowerCase() + name.slice(1)] = v; };
    return { state, c, removed, actions: create(c) };
  }
  test("membership lookup separates network failures from expired identity and ignores a cleared customer's late response", async () => {
    for (const status of [500, 401, 403]) {
      const f = fixture(async () => ({ ok: false, status, json: async () => ({ error: "failed" }) }));
      await f.actions.loadPortal("session");
      if (status === 500) { assert.deepEqual(f.state.memberships, ["existing"]); assert.equal(f.removed.length, 0); }
      else { assert.deepEqual(f.state.memberships, []); assert.equal(f.state.verified, false); assert.equal(f.removed[0][1], "session"); }
    }
    let resolve;
    const f = fixture(() => new Promise((r) => { resolve = r; }));
    const pending = f.actions.loadPortal("session");
    f.actions.clearIdentity();
    resolve({ ok: true, json: async () => ({ ok: true, data: { browser_token: "old", memberships: ["old"], plans: [] } }) }); await pending;
    assert.equal(f.state.token, null); assert.equal(f.state.verified, false); assert.deepEqual(f.state.memberships, []);
  });
  test("membership purchase requires verification and blocks concurrent plans until failed request unlocks", async () => {
    const pending = [];
    const f = fixture(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
    const plan = { id: "a", price: 100 };
    await create({ ...f.c, verified: false }).purchase(plan); assert.equal(pending.length, 0);
    f.c.lookupBusy.current = true;
    await f.actions.purchase(plan); assert.equal(pending.length, 0);
    f.c.lookupBusy.current = false;
    const first = f.actions.purchase(plan); await f.actions.purchase({ ...plan, id: "b" }); assert.equal(pending.length, 1);
    pending[0].reject(new Error("payment failed")); await first;
    assert.equal(f.c.purchaseLock.current, false); assert.equal(f.state.buying, null);
  });
}

{
  const code = readFileSync(new URL("../app/register/page.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("page.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let submitCode;
  function find(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "submit") submitCode = node.getText(ast);
    ts.forEachChild(node, find);
  }
  find(ast); assert.ok(submitCode);
  const compiled = ts.transpileModule(`export function create(c) {
    const { submitLock, event, selectedTicket, sessionId, ticketId, name, phone, email, answers, termsAccepted, marketingOptIn, discountCode, membershipCode, clinicSlug, clinicId, accessToken, liffRequested, liffReady, idToken, liffError, setError, setSubmitting, trackFunnelEvent, readApi, onSuccess } = c;
    ${submitCode} return submit;
  }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
  const { create } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);
  function fixture(overrides = {}) {
    const pending = [], state = {};
    const c = { submitLock: { current: false }, event: { id: "event", sessions: [{ id: "s" }], ticket_types: [{ id: "t" }], fields: [], terms_text: "" }, selectedTicket: { id: "t" }, sessionId: "s", ticketId: "t", name: "顧客", phone: "0912345678", email: "", answers: {}, termsAccepted: true, marketingOptIn: false, discountCode: "", membershipCode: "", clinicSlug: "brand", clinicId: null, accessToken: null, liffRequested: false, liffReady: false, idToken: null, liffError: null,
      setError: (v) => { state.error = v; }, setSubmitting: (v) => { state.busy = v; }, trackFunnelEvent() {}, onSuccess: (v) => { state.result = v; }, readApi: (url, options) => new Promise((resolve, reject) => pending.push({ url, options, resolve, reject })), ...overrides };
    return { pending, state, c, submit: create(c) };
  }
  test("registration submit rejects invalid selection, incomplete LINE identity and blank required answers", async () => {
    for (const override of [{ sessionId: "other" }, { selectedTicket: null }, { name: " " }, { liffRequested: true, liffReady: true, idToken: null }, { event: { sessions: [{ id: "s" }], ticket_types: [], fields: [{ required: true, field_key: "q", label: "問題" }] }, answers: { q: "   " } }]) {
      const f = fixture(override); await f.submit(); assert.equal(f.pending.length, 0); assert.ok(f.state.error);
    }
  });
  test("registration submit permits retry after failure but holds lock after success", async () => {
    const f = fixture(); const first = f.submit(); await f.submit(); assert.equal(f.pending.length, 1);
    f.pending[0].reject(new Error("failed")); await first; assert.equal(f.c.submitLock.current, false);
    const next = f.submit(); await f.submit(); assert.equal(f.pending.length, 2);
    const payload = JSON.parse(f.pending[1].options.body); assert.equal(payload.event_id, "event"); assert.equal(payload.session_id, "s");
    f.pending[1].resolve({ registration_id: "created" }); await next; await f.submit();
    assert.equal(f.pending.length, 2); assert.equal(f.c.submitLock.current, true); assert.equal(f.state.result.registration_id, "created");
  });
}

for (const page of ["page.tsx", "browser/page.tsx"]) {
  const code = readFileSync(new URL(`../app/book/${page}`, import.meta.url), "utf8");
  const ast = ts.createSourceFile("page.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const method = page === "page.tsx" ? "handleSubmit" : "submit";
  let fn;
  function find(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === method) fn = node.getText(ast); ts.forEachChild(node, find); }
  find(ast); assert.ok(fn);
  const compiled = ts.transpileModule(`export function create(c) {
    const { CustomerApiError = class extends Error {}, changeCustomer = () => {}, availabilityLoading = false, availabilityError = null, config, idToken, bookingFlow, submitLock, token, selectedPatientId, addingNew, selectedService, providerRequired, doctorId, serviceId, date, pickedStart, pickedTemplate, name, phone, birthday, email, membershipCode, bookingAnswers, selectedAddonIds, recurrenceCount, visitType, joiningWaitlist, bookingFieldsReady, trackFunnelEvent, api, rememberBrowserToken, loadBound, setToken, setSubmitting, setSubmitErr, setLoading, setError, setResult, setWaitlistResult } = c;
    ${fn} return ${method};
  }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
  const { create } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);
  for (const joiningWaitlist of [false, true]) test(`${page} ${joiningWaitlist ? "waitlist" : "booking"}: duplicate submit is blocked and failure permits retry`, async () => {
    const pending = [], state = {}, submitLock = { current: false };
    const c = { config: { booking_mode: "time", services: [{ id: "s" }] }, idToken: "id", bookingFlow: { canSubmit: true }, submitLock, token: "browser", selectedPatientId: "p", addingNew: false, selectedService: { booking_fields: [] }, providerRequired: true, doctorId: "d", serviceId: "s", date: "2026-09-20", pickedStart: "2026-09-20T10:00:00+08:00", pickedTemplate: "", name: "顧客", phone: "0912345678", birthday: "1990-01-01", email: "", membershipCode: "", bookingAnswers: {}, selectedAddonIds: [], recurrenceCount: 1, visitType: "return", joiningWaitlist, bookingFieldsReady: () => true, trackFunnelEvent() {}, rememberBrowserToken() {}, loadBound() {},
      api: (url, init) => new Promise((resolve, reject) => pending.push({ url, init, resolve, reject })) };
    for (const key of ["setToken", "setSubmitting", "setSubmitErr", "setLoading", "setError", "setResult", "setWaitlistResult"]) c[key] = (v) => { state[key] = v; };
    const submit = create(c);
    const first = submit(); await submit(); assert.equal(pending.length, 1);
    pending[0].reject(new Error("failed")); await first; assert.equal(submitLock.current, false);
    const retry = submit(); await submit(); assert.equal(pending.length, 2);
    assert.equal(pending[1].url, joiningWaitlist ? "/api/booking/waitlist" : "/api/booking/reserve");
    pending[1].resolve({ appointment_id: "created", deposit_status: "pending" }); await retry; await submit();
    assert.equal(pending.length, 2); assert.equal(submitLock.current, true);
  });
  if (page === "browser/page.tsx") for (const bookingMode of ["time", "number"]) {
    test(`browser rebooking ${bookingMode} uses existing identity without re-entering PII; new identity still requires fields`, async () => {
      const calls = [], state = {};
      const c = { config: { booking_mode: bookingMode, services: [{ id: "s" }] }, submitLock: { current: false }, token: "verified-browser", selectedService: { booking_fields: [] }, providerRequired: false, doctorId: "", serviceId: "s", date: "2026-09-22", pickedStart: bookingMode === "time" ? "2026-09-22T10:00:00+08:00" : "", pickedTemplate: bookingMode === "number" ? "template" : "", name: "", phone: "", birthday: "", email: "", membershipCode: "", bookingAnswers: {}, selectedAddonIds: [], recurrenceCount: 1, visitType: "return", joiningWaitlist: false, bookingFieldsReady: () => true, trackFunnelEvent() {}, rememberBrowserToken() {}, api: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { appointment_id: "new" }; } };
      for (const key of ["setToken", "setLoading", "setError", "setResult", "setWaitlistResult"]) c[key] = value => { state[key] = value; };
      await create(c)();
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, "/api/booking/reserve");
      assert.equal(calls[0].body.browser_token, "verified-browser");
      assert.equal(calls[0].body.name, undefined);
      assert.equal(state.setResult.appointment_id, "new");
      calls.length = 0;
      c.token = null; c.submitLock.current = false;
      await create(c)();
      assert.equal(calls.length, 0);
      assert.match(state.setError, /姓名/);
    });
  }
}

for (const page of ["reschedule", "browser/reschedule"]) {
  const code = readFileSync(new URL(`../app/book/${page}/page.tsx`, import.meta.url), "utf8");
  const ast = ts.createSourceFile("page.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let submitCode, payCode;
  function find(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "submit") submitCode = node.getText(ast);
    if (ts.isFunctionDeclaration(node) && node.name?.text === "payDeposit") payCode = node.getText(ast);
    ts.forEachChild(node, find);
  }
  find(ast); assert.ok(submitCode && payCode);
  const compiled = ts.transpileModule(`export function create(c) {
    const { submitLock, paymentLock, idToken, token, appointment, config, selectionReady, availabilityLoading, submitting, doctorId, serviceId, pickedStart, pickedTemplate, date, result, brandSuffix, scopePage, api, document, setError, setSubmitting, setResult, setPaying, setPaymentError } = c;
    ${submitCode} ${payCode} return { submit, payDeposit };
  }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
  const { create } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);
  function fixture(mode = "time") {
    const requests = [], state = {};
    const c = { submitLock: { current: false }, paymentLock: { current: false }, idToken: "id", token: "browser", appointment: { id: "original" }, config: { booking_mode: mode }, selectionReady: true, availabilityLoading: false, submitting: false, doctorId: "d", serviceId: "s", pickedStart: "2026-09-20T10:00:00+08:00", pickedTemplate: "template", date: "2026-09-20", result: { appointment_id: "changed", deposit_status: "pending" }, brandSuffix: "?clinic_slug=a", scopePage: (path) => `${path}?clinic_slug=a`,
      api: (url, init) => new Promise((resolve, reject) => requests.push({ url, init, resolve, reject })),
      document: { createElement: () => ({ style: {}, appendChild() {}, submit() { state.sent = true; } }), body: { appendChild() {} } } };
    for (const key of ["setError", "setSubmitting", "setResult", "setPaying", "setPaymentError"]) c[key] = (v) => { state[key] = v; };
    return { requests, state, c, actions: create(c) };
  }
  test(`${page}: time and session reschedules cannot be submitted twice and failures unlock`, async () => {
    for (const mode of ["time", "number"]) {
      const f = fixture(mode), first = f.actions.submit(); await f.actions.submit(); assert.equal(f.requests.length, 1);
      f.requests[0].reject(new Error("failed")); await first; assert.equal(f.c.submitLock.current, false);
      const retry = f.actions.submit(); const body = JSON.parse(f.requests[1].init.body);
      assert.equal(body.appointment_id, "original");
      if (mode === "number") { assert.equal(body.template_id, "template"); assert.equal(body.date, "2026-09-20"); }
      else assert.equal(body.start_at, f.c.pickedStart);
      f.requests[1].resolve({ appointment_id: "changed" }); await retry; await f.actions.submit(); assert.equal(f.requests.length, 2);
    }
  });
  test(`${page}: deposit payment returns to branded records and prevents concurrent payment forms`, async () => {
    const f = fixture(), pending = f.actions.payDeposit(); await f.actions.payDeposit(); assert.equal(f.requests.length, 1);
    const body = JSON.parse(f.requests[0].init.body);
    const url = new URL(body.return_path, "https://brand.example");
    assert.equal(url.searchParams.get("clinic_slug"), "a");
    if (page.startsWith("browser")) assert.equal(url.pathname, "/book/browser/my");
    else { assert.equal(url.pathname, "/book"); assert.equal(url.searchParams.get("view"), "appointments"); }
    assert.equal(body.appointment_id, "changed");
    f.requests[0].resolve({ form: { action: "https://payment.example", fields: {} } }); await pending;
    assert.equal(f.state.sent, true); assert.equal(f.c.paymentLock.current, true);
  });
}

for (const route of ["patient", "browser/start"]) {
  const code = readFileSync(new URL(`../app/api/booking/${route}/route.ts`, import.meta.url), "utf8");
  const ast = ts.createSourceFile("route.ts", code, ts.ScriptTarget.Latest, true);
  const funcs = ast.statements.filter(ts.isFunctionDeclaration).map((n) => n.getText(ast).replace(/^export /, "")).join("\n");
  const helper = readFileSync(new URL("../lib/public-patient-input.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(`${helper}
    export function create(c) {
      const { checkRateLimit, fail, ok, createServiceClient, getClinicSettings, resolvePublicClinicId, verifyClinicLiffIdToken, saveLineCustomerIdentity, createBrowserBookingToken } = c;
      ${funcs} return POST;
    }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
  const { create } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);
  test(`${route}: malformed identities return 400 before any database or LINE request`, async () => {
    let calls = 0;
    const handler = create({ checkRateLimit: async () => ({ allowed: true }), fail: (error, status = 400) => ({ error, status }), createServiceClient: () => { calls += 1; throw new Error("must not access database"); } });
    const valid = { name: "顧客", phone: "0912345678", birthday: "1990-01-01", idToken: "test" };
    const invalid = [null, [], { ...valid, name: 1 }, { ...valid, phone: [] }, { ...valid, birthday: "2025-02-29" }];
    if (route === "patient") invalid.push({ ...valid, idToken: {} });
    for (const body of invalid) {
      const response = await handler({ json: async () => body });
      assert.equal(response.status, 400);
    }
    assert.equal(calls, 0);
  });
}
