import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { collectBrowserNotices } from "./collect-browser-notices.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const proofRoot = process.env.WISE_NOTICE_PROOF_ROOT || process.cwd();
const domifyIndex = readFileSync(join(proofRoot, "node_modules/domify/index.js"));
const domifyNotice = process.env.WISE_DOMIFY_NOTICE || join(proofRoot, "tools/notices/domify-1.4.2-LICENSE.txt");

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "browser-notices-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture-root", version: "1.0.0", license: "PolyForm-Noncommercial-1.0.0" }));
  writeFileSync(join(root, "LICENSE"), "Synthetic root licence text.\n");
  writeFileSync(join(root, "NOTICE"), "Synthetic root notice text.\n");
  const output = join(root, "apps/api/src/wise_platform_api/static");
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "index.html"), "Synthetic browser index.");
  const tree = { path: root, name: "fixture-root", version: "1.0.0", dependencies: {} };
  return { root, output, tree };
}

function dependency(f, name, { version = "1.0.0", license = "MIT", metadata = {}, text = Buffer.from("Synthetic dependency licence text.\n") } = {}) {
  const path = join(f.root, "node_modules", name);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "package.json"), JSON.stringify({ name, version, license, ...metadata }));
  if (text !== null) writeFileSync(join(path, "LICENSE"), text);
  return { path, name, version, dependencies: {} };
}

test("preserves original bytes, hashes and offsets with deterministic relative-path outputs", (t) => {
  const f = fixture(t);
  const original = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("Synthetic umlaut Ä.\r\nSecond line.\r\n")]);
  f.tree.dependencies.alpha = dependency(f, "fixture-alpha", { text: original });
  const manifest = collectBrowserNotices(f);
  const text = readFileSync(join(f.output, "THIRD-PARTY-NOTICES.txt"));
  const json = readFileSync(join(f.output, "THIRD-PARTY-NOTICES.json"));
  const entry = manifest.packages.find((p) => p.name === "fixture-alpha").files[0];
  assert.equal(entry.sha256, hash(original));
  assert.deepEqual(text.subarray(entry.text_byte_offset, entry.text_byte_offset + entry.byte_count), original);
  assert.equal(manifest.text_sha256, hash(text));
  assert.equal(entry.path, "node_modules/fixture-alpha/LICENSE");
  assert.equal(json.includes(Buffer.from(f.root)), false);
  collectBrowserNotices(f);
  assert.deepEqual(readFileSync(join(f.output, "THIRD-PARTY-NOTICES.txt")), text);
  assert.deepEqual(readFileSync(join(f.output, "THIRD-PARTY-NOTICES.json")), json);
});

test("retains a later full child tree after an earlier deduplicated package leaf", (t) => {
  const f = fixture(t);
  const alpha = dependency(f, "fixture-alpha");
  const beta = dependency(f, "fixture-beta");
  f.tree.dependencies["first-leaf"] = { ...alpha };
  f.tree.dependencies["later-full"] = { ...alpha, dependencies: { beta } };
  const manifest = collectBrowserNotices(f);
  assert.equal(manifest.packages.filter((p) => p.name === "fixture-alpha").length, 1);
  assert.equal(manifest.packages.filter((p) => p.name === "fixture-beta").length, 1);
});

test("rejects a missing licence before modifying prior outputs", (t) => {
  const f = fixture(t);
  f.tree.dependencies.alpha = dependency(f, "fixture-alpha");
  collectBrowserNotices(f);
  const previous = readFileSync(join(f.output, "THIRD-PARTY-NOTICES.txt"));
  const previousManifest = readFileSync(join(f.output, "THIRD-PARTY-NOTICES.json"));
  unlinkSync(join(f.tree.dependencies.alpha.path, "LICENSE"));
  assert.throws(() => collectBrowserNotices(f), /Required licence text is missing/);
  assert.deepEqual(readFileSync(join(f.output, "THIRD-PARTY-NOTICES.txt")), previous);
  assert.deepEqual(readFileSync(join(f.output, "THIRD-PARTY-NOTICES.json")), previousManifest);
});

test("skips a declared uninstalled optional peer and refuses an uninstalled required dependency", (t) => {
  const f = fixture(t);
  const alpha = dependency(f, "fixture-alpha", { metadata: { peerDependencies: { optional: "*" }, peerDependenciesMeta: { optional: { optional: true } } } });
  alpha.dependencies.optional = {};
  f.tree.dependencies.alpha = alpha;
  assert.deepEqual(collectBrowserNotices(f).omitted_optional_dependencies,
    [{ parent: "fixture-alpha", name: "optional", reason: "optional_not_installed" }]);
  alpha.dependencies.required = {};
  assert.throws(() => collectBrowserNotices(f), /Required installed dependency is missing: required/);
});

test("refuses a notice symlink outside the project", (t) => {
  const f = fixture(t);
  const outside = mkdtempSync(join(tmpdir(), "browser-notices-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, "LICENSE"), "Synthetic outside notice.");
  f.tree.dependencies.alpha = dependency(f, "fixture-alpha", { text: null });
  symlinkSync(join(outside, "LICENSE"), join(f.tree.dependencies.alpha.path, "LICENSE"));
  assert.throws(() => collectBrowserNotices(f), /outside the project root/);
  assert.equal(existsSync(join(f.output, "THIRD-PARTY-NOTICES.txt")), false);
});

test("preserves Flow copied-asset notices and refuses a missing declared copied file", (t) => {
  const f = fixture(t);
  const flow = dependency(f, "wise-flow", { version: "0.3.5", license: "PolyForm-Noncommercial-1.0.0" });
  f.tree.dependencies.flow = flow;
  mkdirSync(join(flow.path, "dist/licenses"), { recursive: true });
  writeFileSync(join(flow.path, "NOTICE"), "Synthetic Flow notice.");
  writeFileSync(join(flow.path, "THIRD_PARTY_NOTICES.md"), "Synthetic copied asset: `dist/licenses/example.txt`\n");
  writeFileSync(join(flow.path, "dist/licenses/example.txt"), "Synthetic copied licence exact text.\r\n");
  const record = collectBrowserNotices(f).packages.find((p) => p.name === "wise-flow");
  assert.ok(record.files.some((file) => file.path.endsWith("dist/licenses/example.txt") && file.role === "copied_asset_notice"));
  unlinkSync(join(flow.path, "dist/licenses/example.txt"));
  assert.throws(() => collectBrowserNotices(f), /Required notice is missing.*wise-flow dist\/licenses\/example/);
});

test("requires the verified domify version, runtime bytes and exact supplied notice", (t) => {
  const f = fixture(t);
  const domify = dependency(f, "domify", { version: "1.4.2", text: null });
  f.tree.dependencies.domify = domify;
  writeFileSync(join(domify.path, "index.js"), domifyIndex);
  assert.throws(() => collectBrowserNotices(f), /verified licence supplement/);
  const record = collectBrowserNotices({ ...f, domifyNotice }).packages.find((p) => p.name === "domify");
  assert.equal(record.files[0].sha256, "199c19a2d597413e2b38deb2ae855edbef909d6dc5516c8fd7fe04f8b9e7ae97");
  assert.equal(record.files[0].path, basename(domifyNotice));
  assert.equal(record.files[0].verification.runtime_sha256, "89b84bf82ed984331e79ce4f6d681240e8b2a34acf66989a2cebf54b010f9f00");
  writeFileSync(join(domify.path, "index.js"), Buffer.concat([domifyIndex, Buffer.from("\n")]));
  assert.throws(() => collectBrowserNotices({ ...f, domifyNotice }), /runtime bytes differ/);
  writeFileSync(join(domify.path, "index.js"), domifyIndex);
  domify.version = "1.4.3";
  writeFileSync(join(domify.path, "package.json"), JSON.stringify({ name: "domify", version: "1.4.3", license: "MIT" }));
  assert.throws(() => collectBrowserNotices({ ...f, domifyNotice }), /no supplied licence for this installed version/);
});

test("rejects altered domify notice bytes and empty ordinary licence files", (t) => {
  const f = fixture(t);
  const domify = dependency(f, "domify", { version: "1.4.2", text: null });
  f.tree.dependencies.domify = domify;
  writeFileSync(join(domify.path, "index.js"), domifyIndex);
  const bad = join(f.root, "supplied-notice.txt");
  writeFileSync(bad, "Synthetic unverified replacement.");
  assert.throws(() => collectBrowserNotices({ ...f, domifyNotice: bad }), /supplied licence bytes differ/);
  delete f.tree.dependencies.domify;
  f.tree.dependencies.alpha = dependency(f, "fixture-alpha", { text: Buffer.from(" \n\t") });
  assert.throws(() => collectBrowserNotices(f), /no readable text/);
});
