import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const TEXT_NAME = "THIRD-PARTY-NOTICES.txt";
const MANIFEST_NAME = "THIRD-PARTY-NOTICES.json";
const DOMIFY = Object.freeze({
  version: "1.4.2",
  runtimeSha256: "89b84bf82ed984331e79ce4f6d681240e8b2a34acf66989a2cebf54b010f9f00",
  noticeSha256: "199c19a2d597413e2b38deb2ae855edbef909d6dc5516c8fd7fe04f8b9e7ae97",
  sourceCommit: "c07983e275dc561d5611755cf084f505aeba537b",
});

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const posix = (path) => path.split(sep).join("/");
const legalName = /^(?:licen[cs]e|licensing|copying|notice|third[-_]party[-_](?:notices?|licen[cs]es?))(?:$|[._ -])/i;
const licenceName = /^(?:licen[cs]e|copying)(?:$|[._ -])/i;
const legalDirectory = /^(?:licen[cs]es|notices)$/i;

function projectRelative(root, path) {
  const result = relative(root, realpathSync(path));
  if (isAbsolute(result) || result === ".." || result.startsWith(`..${sep}`)) {
    throw new Error("A dependency or notice resolves outside the project root.");
  }
  return posix(result) || ".";
}

function packageJson(path) {
  const value = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
  if (typeof value.name !== "string" || typeof value.version !== "string" || typeof value.license !== "string" || !value.license.trim()) {
    throw new Error("An installed package is missing its name, version or declared licence.");
  }
  return value;
}

function readText(path, label) {
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch {
    throw new Error(`Required notice is missing or unreadable: ${label}.`);
  }
  let decoded;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`Required notice is not UTF-8 text: ${label}.`);
  }
  if (!decoded.trim() || bytes.includes(0)) throw new Error(`Required notice has no readable text: ${label}.`);
  return bytes;
}

function noticeFiles(packagePath) {
  const result = [];
  function walk(directory, insideLegalDirectory = false) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path, insideLegalDirectory || legalDirectory.test(entry.name));
      else if ((entry.isFile() || entry.isSymbolicLink()) && (insideLegalDirectory || legalName.test(entry.name))) {
        if (!statSync(path).isFile()) throw new Error("A notice is not a regular file.");
        result.push(path);
      }
    }
  }
  walk(packagePath);
  return result;
}

function suppliedDomify(root, packagePath, metadata, suppliedPath) {
  if (metadata.version !== DOMIFY.version) throw new Error("domify has no supplied licence for this installed version.");
  const runtimePath = join(packagePath, "index.js");
  if (sha256(readFileSync(runtimePath)) !== DOMIFY.runtimeSha256) {
    throw new Error("domify runtime bytes differ from the verified licence supplement binding.");
  }
  const path = resolve(suppliedPath || join(root, "tools/notices/domify-1.4.2-LICENSE.txt"));
  const bytes = readText(path, "domify 1.4.2 verified licence supplement");
  if (sha256(bytes) !== DOMIFY.noticeSha256) throw new Error("domify supplied licence bytes differ from the verified source.");
  let sourcePath;
  let origin = "project_supplied_notice";
  try {
    sourcePath = projectRelative(root, path);
  } catch {
    // A caller can supply the audited file separately; only its relative file
    // name and immutable content binding belong in the distributed manifest.
    sourcePath = basename(path);
    origin = "separately_supplied_notice";
  }
  return { bytes, file: { path: sourcePath, origin, role: "license", sha256: sha256(bytes), byte_count: bytes.length,
    verification: { package_version: DOMIFY.version, runtime_file: projectRelative(root, runtimePath),
      runtime_sha256: DOMIFY.runtimeSha256, source_repository: "https://github.com/sindresorhus/domify",
      source_commit: DOMIFY.sourceCommit } } };
}

function flowCopiedNotices(packagePath, files) {
  for (const name of ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"]) {
    if (!files.some((path) => relative(packagePath, path) === name)) throw new Error(`wise-flow required notice is missing: ${name}.`);
  }
  const declaration = readText(join(packagePath, "THIRD_PARTY_NOTICES.md"), "wise-flow third-party notices").toString("utf8");
  const references = [...declaration.matchAll(/`(dist\/licenses\/[^`]+)`/g)].map((match) => match[1]);
  if (!references.length) throw new Error("wise-flow has no declared copied-asset licence references.");
  for (const reference of references) {
    const path = resolve(packagePath, reference);
    const local = relative(packagePath, path);
    if (isAbsolute(local) || local.startsWith(`..${sep}`) || local === "..") throw new Error("wise-flow copied-asset notice escapes its package.");
    readText(path, `wise-flow ${reference}`);
    if (!files.some((file) => resolve(file) === path)) throw new Error(`wise-flow copied notice was not collected: ${reference}.`);
  }
}

export function collectBrowserNotices({ root, tree, domifyNotice, outputDirectory } = {}) {
  root = realpathSync(resolve(root || process.cwd()));
  const rootMetadata = packageJson(root);
  const output = resolve(outputDirectory || join(root, "apps/api/src/wise_platform_api/static"));
  projectRelative(root, output);
  if (!existsSync(join(output, "index.html"))) throw new Error("Built browser index is missing; collect notices after the browser build.");
  if (!tree || typeof tree !== "object" || tree.problems?.length) throw new Error("A complete installed npm runtime dependency tree is required.");
  const packages = new Map();
  const omitted = new Map();
  const visitedObjects = new WeakSet();
  function walk(node, parentMetadata, alias) {
    if (!node || typeof node !== "object") throw new Error("Invalid installed npm dependency entry.");
    if (visitedObjects.has(node)) return;
    visitedObjects.add(node);
    if (!node.path) {
      const optional = parentMetadata?.optionalDependencies?.[alias] !== undefined ||
        (parentMetadata?.peerDependencies?.[alias] !== undefined && parentMetadata?.peerDependenciesMeta?.[alias]?.optional === true);
      if (!optional) throw new Error(`Required installed dependency is missing: ${alias || "root"}.`);
      omitted.set(`${parentMetadata.name}:${alias}`, { parent: parentMetadata.name, name: alias, reason: "optional_not_installed" });
      return;
    }
    const packagePath = realpathSync(node.path);
    const packageRoot = projectRelative(root, packagePath);
    const metadata = packageJson(packagePath);
    if (node.version && node.version !== metadata.version) throw new Error(`Installed version differs from npm tree: ${metadata.name}.`);
    if (!packages.has(packagePath)) {
      const workspace = packageRoot === "." || !packageRoot.split("/").includes("node_modules");
      let paths = workspace ? ["LICENSE", "NOTICE"].map((name) => join(root, name)) : noticeFiles(packagePath);
      if (workspace && metadata.license !== rootMetadata.license) throw new Error(`Workspace licence differs from root: ${metadata.name}.`);
      if (metadata.name === "wise-flow") flowCopiedNotices(packagePath, paths);
      const entries = paths.map((path) => {
        const sourcePath = projectRelative(root, path);
        const localPath = posix(relative(packagePath, path));
        const bytes = readText(path, sourcePath);
        const role = localPath.startsWith("dist/licenses/") ? "copied_asset_notice" :
          licenceName.test(basename(path)) ? "license" : "notice";
        return { bytes, file: { path: sourcePath, origin: workspace ? "workspace_root_notice" : "installed_package",
          role, sha256: sha256(bytes), byte_count: bytes.length } };
      });
      if (!entries.some((entry) => entry.file.role === "license")) {
        if (metadata.name === "domify") entries.push(suppliedDomify(root, packagePath, metadata, domifyNotice));
        else throw new Error(`Required licence text is missing: ${metadata.name}@${metadata.version}.`);
      }
      const source = join(packagePath, "package.json");
      packages.set(packagePath, { name: metadata.name, version: metadata.version, license: metadata.license, root: packageRoot,
        package_source: { path: projectRelative(root, source), sha256: sha256(readFileSync(source)) }, entries });
    }
    // npm can first show a deduplicated leaf and later the same package with its
    // full dependencies. Deduplicate texts without dropping later child trees.
    for (const [name, child] of Object.entries(node.dependencies || {}).sort(([a], [b]) => a.localeCompare(b, "en"))) walk(child, metadata, name);
  }
  walk(tree);
  const ordered = [...packages.values()].sort((a, b) => `${a.name}\0${a.version}\0${a.root}`.localeCompare(`${b.name}\0${b.version}\0${b.root}`, "en"));
  const chunks = [Buffer.from("Installed browser runtime dependency licence and notice texts\nEach provided text retains its original scope and content.\n")];
  const records = ordered.map(({ entries, ...pkg }) => {
    const files = entries.sort((a, b) => a.file.path.localeCompare(b.file.path, "en")).map(({ bytes, file }) => {
      chunks.push(Buffer.from(`\n\n===== ${pkg.name}@${pkg.version} =====\nDeclared licence: ${pkg.license}\nSource file: ${file.path}\nSHA-256: ${file.sha256}\n\n`));
      const offset = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      chunks.push(bytes);
      return { ...file, text_byte_offset: offset };
    });
    return { ...pkg, files };
  });
  const text = Buffer.concat(chunks);
  const manifest = { schema_version: 1, scope: "installed_npm_runtime_closure", text_file: TEXT_NAME,
    text_sha256: sha256(text), packages: records, omitted_optional_dependencies: [...omitted.values()].sort((a, b) => `${a.parent}:${a.name}`.localeCompare(`${b.parent}:${b.name}`, "en")) };
  const json = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
  // Validate the complete closure and all texts before changing either output.
  mkdirSync(output, { recursive: true });
  for (const [name, bytes] of [[TEXT_NAME, text], [MANIFEST_NAME, json]]) {
    const temporary = join(output, `.${name}.${process.pid}.tmp`);
    writeFileSync(temporary, bytes);
    renameSync(temporary, join(output, name));
  }
  return manifest;
}

function workspaceRoot(start) {
  let path = resolve(start);
  for (;;) {
    const metadata = join(path, "package.json");
    if (existsSync(metadata) && JSON.parse(readFileSync(metadata, "utf8")).workspaces) return path;
    const parent = dirname(path);
    if (parent === path) throw new Error("Cannot locate the npm workspace root; supply --root.");
    path = parent;
  }
}

function npmCli(explicit) {
  const candidates = [explicit, process.env.npm_execpath,
    join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
    join(dirname(dirname(process.execPath)), "lib/node_modules/npm/bin/npm-cli.js")].filter(Boolean);
  const found = candidates.find((path) => existsSync(path));
  if (!found) throw new Error("Run through npm or supply --npm-cli with its npm-cli.js path.");
  return resolve(found);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      const name = process.argv[i];
      if (!["--root", "--npm-cli", "--domify-notice"].includes(name) || !process.argv[i + 1]) throw new Error("Usage: collect-browser-notices.mjs [--root directory] [--npm-cli file] [--domify-notice file]");
      options[name] = process.argv[i + 1];
    }
    const root = options["--root"] ? resolve(options["--root"]) : workspaceRoot(process.cwd());
    let tree;
    try {
      tree = JSON.parse(execFileSync(process.execPath, [npmCli(options["--npm-cli"]), "ls", "--omit=dev", "--all", "--json", "--long"],
        { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }));
    } catch {
      throw new Error("npm did not return a complete installed runtime dependency tree.");
    }
    const manifest = collectBrowserNotices({ root, tree, domifyNotice: options["--domify-notice"] });
    console.log(JSON.stringify({ packages: manifest.packages.length, text_file: manifest.text_file, text_sha256: manifest.text_sha256 }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
