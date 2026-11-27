// Drop-in @swc/core for FreeBSD, backed by upstream's @swc/wasm of the same
// version (@swc/core-freebsd-x64 stopped at 1.3.11; the wasm32-wasi package its
// loader falls back to was never published). Same pattern as @next/swc-wasm-nodejs.
//
// @swc/cli calls transform/transformSync/transformFile/transformFileSync. Three
// things differ from the native binding and are what this file exists for:
//   - the native binding reads .swcrc itself; wasm does not
//   - the CLI passes keys it has no value for (jsc.parser: undefined,
//     jsc.transform: {}), and a plain spread would erase .swcrc -- dropping the
//     typescript parser and legacyDecorator, so only decorated files fail
//   - wasm throws bare strings, and the CLI does err.message.includes(...)
const fs = require("fs");
const path = require("path");
const wasm = require("@swc/wasm");

function findSwcrc(from) {
  let dir = path.resolve(path.dirname(from || "."));
  for (let prev = null; dir !== prev; prev = dir, dir = path.dirname(dir)) {
    const candidate = path.join(dir, ".swcrc");
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Overlay only what the caller actually set, recursing into nested config.
function overlay(base, override) {
  const out = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (value === undefined) continue;
    if (isObject(value)) {
      if (!Object.keys(value).length && isObject(out[key])) continue;
      out[key] = overlay(isObject(out[key]) ? out[key] : {}, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

// `filename` stays exactly as given: jsc.paths rewriting is computed against it,
// and an absolute path with a relative baseUrl emits wrong ../ depth.
function mergeConfig(opts) {
  if (opts.swcrc === false) return opts;
  const rcPath = findSwcrc(opts.filename);
  if (!rcPath) return opts;
  const rc = JSON.parse(fs.readFileSync(rcPath, "utf8"));
  delete rc.$schema;
  const config = overlay(rc, opts);
  delete config.$schema;
  delete config.stripLeadingPaths; // CLI-layer option; wasm rejects it
  return config;
}

function run(code, opts) {
  try {
    return wasm.transformSync(code, mergeConfig(opts));
  } catch (err) {
    throw typeof err === "string" ? new Error(err) : err;
  }
}

const transformSync = (code, opts = {}) => run(code, opts);
const transformFileSync = (filename, opts = {}) =>
  run(fs.readFileSync(filename, "utf8"), { ...opts, filename });
const transform = (code, opts) => Promise.resolve().then(() => transformSync(code, opts));
const transformFile = (filename, opts) =>
  Promise.resolve().then(() => transformFileSync(filename, opts));

module.exports = { ...wasm, transform, transformSync, transformFile, transformFileSync };
