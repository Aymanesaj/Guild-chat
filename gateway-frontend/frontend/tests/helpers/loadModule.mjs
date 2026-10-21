import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { transformWithOxc } from "vite";

/** Load frontend modules with explicit dependencies and browser globals. */
export async function loadModule(file, mocks, globals = {}) {
  const path = new URL(`../../src/${file}`, import.meta.url);
  let code = await readFile(path, "utf8");
  if (file.endsWith(".jsx")) code = (await transformWithOxc(code, path.pathname)).code;
  const context = vm.createContext({ TextEncoder, console, ...globals });
  const source = new vm.SourceTextModule(code, { context, identifier: path.pathname });
  await source.link((specifier) => {
    assert.ok(specifier in mocks, `Missing mock for ${specifier}`);
    const exports = mocks[specifier];
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context });
  });
  await source.evaluate();
  return source.namespace;
}
