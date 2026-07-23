/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");

const RealDate = Date;
const clockFile = process.env.PHASE17_CLOCK_FILE;
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function clockOffsetMilliseconds() {
  if (!clockFile) return 0;
  try {
    const parsed = JSON.parse(fs.readFileSync(clockFile, "utf8"));
    return Number.isSafeInteger(parsed.offsetMilliseconds)
      ? parsed.offsetMilliseconds
      : 0;
  } catch {
    return 0;
  }
}

class Phase17Date extends RealDate {
  constructor(...argumentsList) {
    if (argumentsList.length === 0) {
      super(RealDate.now() + clockOffsetMilliseconds());
      return;
    }
    super(...argumentsList);
  }

  static now() {
    return RealDate.now() + clockOffsetMilliseconds();
  }

  static parse(value) {
    return RealDate.parse(value);
  }

  static UTC(...argumentsList) {
    return RealDate.UTC(...argumentsList);
  }

  static [Symbol.hasInstance](instance) {
    return instance instanceof RealDate;
  }
}

Object.setPrototypeOf(Phase17Date, RealDate);
globalThis.Date = Phase17Date;

function assertLoopbackUrl(input) {
  const value =
    typeof input === "string" || input instanceof URL
      ? input
      : input && typeof input.url === "string"
        ? input.url
        : undefined;
  if (value === undefined) return;
  const url = new URL(value);
  if (!loopbackHosts.has(url.hostname)) {
    throw new Error("PHASE17_EXTERNAL_NETWORK_BLOCKED");
  }
}

if (typeof globalThis.fetch === "function") {
  const realFetch = globalThis.fetch;
  globalThis.fetch = function phase17Fetch(input, init) {
    assertLoopbackUrl(input);
    return realFetch.call(this, input, init);
  };
}

function guardRequest(original) {
  return function phase17Request(...argumentsList) {
    const candidate = argumentsList[0];
    if (
      typeof candidate === "string" ||
      candidate instanceof URL ||
      (candidate && typeof candidate.href === "string")
    ) {
      assertLoopbackUrl(candidate);
    } else if (candidate && typeof candidate === "object") {
      const hostname = candidate.hostname ?? candidate.host;
      if (
        typeof hostname === "string" &&
        !loopbackHosts.has(hostname.replace(/:\d+$/u, ""))
      ) {
        throw new Error("PHASE17_EXTERNAL_NETWORK_BLOCKED");
      }
    }
    return original.apply(this, argumentsList);
  };
}

http.request = guardRequest(http.request);
http.get = guardRequest(http.get);
https.request = guardRequest(https.request);
https.get = guardRequest(https.get);
