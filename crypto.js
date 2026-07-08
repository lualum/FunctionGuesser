(function (global) {
  "use strict";

  const TOKEN_PREFIX_AES = "fg2.";
  const TOKEN_PREFIX_FALLBACK = "fg1.";
  const APP_PEPPER = "FunctionGuesser.Desmos.HiddenFunction.v2.2026";
  const AES_ITERATIONS = 90000;

  async function encodePuzzle(puzzle) {
    const payload = {
      v: 2,
      q: puzzle.equation,
      a: puzzle.author,
      t: puzzle.createdAt || Date.now(),
      pad: randomPad()
    };
    const raw = utf8Encode(JSON.stringify(payload));

    if (hasSubtleCrypto()) {
      const salt = randomBytes(16);
      const iv = randomBytes(12);
      const key = await deriveAesKey(salt);
      const cipher = new Uint8Array(
        await global.crypto.subtle.encrypt(
          {
            name: "AES-GCM",
            iv
          },
          key,
          raw
        )
      );
      return TOKEN_PREFIX_AES + base64UrlEncode(concatBytes([salt, iv, cipher]));
    }

    const salt = randomBytes(12);
    const masked = fallbackCrypt(raw, salt);
    return TOKEN_PREFIX_FALLBACK + base64UrlEncode(concatBytes([salt, masked]));
  }

  async function decodePuzzle(token) {
    const cleaned = String(token || "").trim();

    if (cleaned.startsWith(TOKEN_PREFIX_AES)) {
      const bytes = base64UrlDecode(cleaned.slice(TOKEN_PREFIX_AES.length));
      if (bytes.length < 30) throw new Error("This puzzle link is too short.");
      const salt = bytes.slice(0, 16);
      const iv = bytes.slice(16, 28);
      const cipher = bytes.slice(28);
      const key = await deriveAesKey(salt);
      const raw = new Uint8Array(
        await global.crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv
          },
          key,
          cipher
        )
      );
      return unpackPuzzlePayload(raw);
    }

    if (cleaned.startsWith(TOKEN_PREFIX_FALLBACK)) {
      const bytes = base64UrlDecode(cleaned.slice(TOKEN_PREFIX_FALLBACK.length));
      if (bytes.length < 13) throw new Error("This puzzle link is too short.");
      const salt = bytes.slice(0, 12);
      const masked = bytes.slice(12);
      return unpackPuzzlePayload(fallbackCrypt(masked, salt));
    }

    throw new Error("This is not a Function Guesser puzzle link.");
  }

  function unpackPuzzlePayload(bytes) {
    const payload = JSON.parse(utf8Decode(bytes));
    return {
      equation: payload.q,
      author: payload.a,
      createdAt: payload.t
    };
  }

  function hasSubtleCrypto() {
    return Boolean(global.crypto && global.crypto.subtle && global.crypto.getRandomValues);
  }

  async function deriveAesKey(salt) {
    const keyMaterial = await global.crypto.subtle.importKey(
      "raw",
      utf8Encode(APP_PEPPER),
      "PBKDF2",
      false,
      ["deriveKey"]
    );

    return global.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: AES_ITERATIONS,
        hash: "SHA-256"
      },
      keyMaterial,
      {
        name: "AES-GCM",
        length: 256
      },
      false,
      ["encrypt", "decrypt"]
    );
  }

  function fallbackCrypt(bytes, salt) {
    let seed = fnv1a(APP_PEPPER);
    for (const byte of salt) {
      seed ^= byte;
      seed = Math.imul(seed, 16777619) >>> 0;
    }

    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i += 1) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      const key = (seed ^ (seed >>> 8) ^ (seed >>> 16)) & 255;
      out[i] = bytes[i] ^ key;
    }
    return out;
  }

  function fnv1a(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function randomBytes(length) {
    const bytes = new Uint8Array(length);
    if (global.crypto && global.crypto.getRandomValues) {
      global.crypto.getRandomValues(bytes);
      return bytes;
    }

    for (let i = 0; i < length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
    return bytes;
  }

  function randomPad() {
    return Array.from(randomBytes(18), (byte) => byte.toString(36).padStart(2, "0")).join("");
  }

  function concatBytes(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  function base64UrlEncode(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return global.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function base64UrlDecode(value) {
    let base64 = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) base64 += "=";
    const binary = global.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function utf8Encode(text) {
    return new global.TextEncoder().encode(text);
  }

  function utf8Decode(bytes) {
    return new global.TextDecoder().decode(bytes);
  }

  global.FunctionGuesserCrypto = {
    encodePuzzle,
    decodePuzzle
  };
})(window);
