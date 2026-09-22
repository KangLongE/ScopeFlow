import assert from "node:assert/strict";
import test from "node:test";
import { backendBaseUrl } from "../src/lib/api";

test("backend URL has a stable local default and no trailing slash", () => {
  const previous = process.env.BACKEND_URL;
  try {
    delete process.env.BACKEND_URL;
    assert.equal(backendBaseUrl(), "http://127.0.0.1:3001");
    process.env.BACKEND_URL = "https://api.example.test/";
    assert.equal(backendBaseUrl(), "https://api.example.test");
  } finally {
    if (previous === undefined) delete process.env.BACKEND_URL;
    else process.env.BACKEND_URL = previous;
  }
});
