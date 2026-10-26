"use strict";

// fetch() with a time limit, so a provider that never answers doesn't leave the
// Suggest/Summarize buttons spinning forever.
async function fetchWithTimeout(url, options, timeoutMs, label) {
  try {
    return await fetch(url, Object.assign({}, options, { signal: AbortSignal.timeout(timeoutMs) }));
  } catch (err) {
    if (err && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new Error(`${label} did not respond within ${Math.round(timeoutMs / 1000)} seconds`, { cause: err });
    }
    throw err;
  }
}

module.exports = { fetchWithTimeout };
