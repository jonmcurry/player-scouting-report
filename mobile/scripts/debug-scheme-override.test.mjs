import test from "node:test";
import assert from "node:assert/strict";
import { debugConfig } from "./debug-scheme-override.mjs";

test("adds an http Android scheme when no server config exists", () => {
  assert.deepEqual(debugConfig({ appId: "com.hitterloop.coach" }), {
    appId: "com.hitterloop.coach",
    server: { androidScheme: "http" },
  });
});

test("overrides only androidScheme and preserves all other config keys", () => {
  const config = {
    appId: "com.hitterloop.coach",
    webDir: "../coach",
    android: { backgroundColor: "#ffffff" },
    plugins: { Example: { enabled: true } },
    server: { androidScheme: "https", hostname: "localhost", allowNavigation: ["example.test"] },
  };
  assert.deepEqual(debugConfig(config), {
    ...config,
    server: { ...config.server, androidScheme: "http" },
  });
});

test("does not mutate the input or its server object", () => {
  const config = Object.freeze({
    appId: "com.hitterloop.coach",
    server: Object.freeze({ androidScheme: "https", hostname: "localhost" }),
  });
  const result = debugConfig(config);
  assert.notEqual(result, config);
  assert.notEqual(result.server, config.server);
  assert.equal(config.server.androidScheme, "https");
});

test("never introduces cleartext and preserves an existing cleartext value", () => {
  for (const config of [{}, { server: {} }, { server: { cleartext: false } }]) {
    const result = debugConfig(config);
    assert.equal(Object.hasOwn(result, "cleartext"), false);
    assert.equal(Object.hasOwn(result.server, "cleartext"), Object.hasOwn(config.server ?? {}, "cleartext"));
    assert.equal(result.server.cleartext, config.server?.cleartext);
  }
});

test("refuses non-object input", () => {
  for (const value of [null, undefined, [], "config", 42, true]) {
    assert.throws(() => debugConfig(value), TypeError);
  }
});
