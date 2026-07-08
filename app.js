(function () {
  "use strict";

  const CREATOR_EXPR_ID = "creator-secret-function";
  const SECRET_EXPR_ID = "__fg_hidden_secret";
  const CHECK_EXPR_ID = "__fg_hidden_check";
  const TOKEN_PREFIX_AES = "fg2.";
  const TOKEN_PREFIX_FALLBACK = "fg1.";
  const APP_PEPPER = "FunctionGuesser.Desmos.HiddenFunction.v2.2026";
  const AES_ITERATIONS = 90000;
  const MAX_FORMULA_LENGTH = 260;
  const MATCH_ABS_TOLERANCE = 0.001;
  const MATCH_REL_TOLERANCE = 0.0001;
  const SAMPLE_POINTS = makeSamplePoints(-10, 10, 401);
  const MIN_FINITE_SECRET_POINTS = 120;
  const SCAN_DELAY_MS = 500;
  const ALLOWED_WORDS = new Set([
    "x",
    "e",
    "pi",
    "sin",
    "cos",
    "tan",
    "cot",
    "sec",
    "csc",
    "arcsin",
    "arccos",
    "arctan",
    "arccot",
    "arcsec",
    "arccsc",
    "sinh",
    "cosh",
    "tanh",
    "ln",
    "log",
    "sqrt",
    "left",
    "right",
    "frac",
    "cdot",
    "times",
    "div",
    "operatorname",
    "abs",
    "floor",
    "ceil",
    "round",
    "min",
    "max",
    "mod",
    "sign"
  ]);

  const state = {
    creatorCalc: null,
    playerCalc: null,
    puzzle: null,
    currentToken: "",
    sampleRows: [],
    scanTimer: 0,
    scanInProgress: false,
    scanQueued: false,
    internalPlayerChanges: 0,
    checkedCandidates: 0,
    solvedGuess: "",
    solvedLabel: ""
  };

  const dom = {};

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    cacheDom();
    bindEvents();

    if (!window.Desmos) {
      setStatus(dom.creatorStatus, "Desmos could not load. Check your connection and refresh.", "error");
      disableButtons();
      return;
    }

    initCreatorCalculator();

    const token = readPuzzleToken();
    if (token) {
      await openPuzzleToken(token);
    } else {
      showCreateView();
      setStatus(dom.creatorStatus, "Edit f(x) in Desmos, then export.");
    }
  }

  function cacheDom() {
    [
      "creatorActions",
      "playerActions",
      "creatorView",
      "playerView",
      "authorInput",
      "exportButton",
      "puzzleLink",
      "copyLinkButton",
      "openPuzzleButton",
      "creatorStatus",
      "playerStatus",
      "puzzleAuthor",
      "creatorCalculator",
      "playerCalculator",
      "completeOverlay",
      "completeSummary",
      "includeSpoiler",
      "discordMessage",
      "copyDiscordButton",
      "closeOverlayButton"
    ].forEach((id) => {
      dom[id] = document.getElementById(id);
    });
  }

  function bindEvents() {
    dom.exportButton.addEventListener("click", handleExport);
    dom.copyLinkButton.addEventListener("click", handleCopyLink);
    dom.openPuzzleButton.addEventListener("click", handleOpenPuzzle);
    dom.includeSpoiler.addEventListener("change", updateDiscordMessage);
    dom.copyDiscordButton.addEventListener("click", handleCopyDiscord);
    dom.closeOverlayButton.addEventListener("click", closeCompletedOverlay);
    window.addEventListener("hashchange", handleHashChange);
  }

  function disableButtons() {
    [
      dom.exportButton,
      dom.copyLinkButton,
      dom.openPuzzleButton,
      dom.copyDiscordButton,
      dom.closeOverlayButton
    ].forEach((button) => {
      button.disabled = true;
    });
  }

  function initCreatorCalculator() {
    if (state.creatorCalc) return;

    state.creatorCalc = Desmos.GraphingCalculator(dom.creatorCalculator, {
      authorFeatures: true,
      expressions: true,
      settingsMenu: true,
      expressionsTopbar: true,
      zoomButtons: true,
      keypad: true,
      folders: true,
      notes: true,
      pasteGraphLink: true,
      border: false,
      graphDescription: "Function Guesser creator graph"
    });

    state.creatorCalc.setMathBounds({
      left: -8,
      right: 8,
      bottom: -6,
      top: 6
    });

    state.creatorCalc.setExpression({
      id: CREATOR_EXPR_ID,
      latex: "f(x)=x^2-3x+2",
      color: "#197b5b",
      lineWidth: 3
    });
  }

  function initPlayerCalculator() {
    if (state.playerCalc) return;

    state.playerCalc = Desmos.GraphingCalculator(dom.playerCalculator, {
      expressions: true,
      settingsMenu: true,
      expressionsTopbar: true,
      zoomButtons: true,
      keypad: true,
      folders: true,
      notes: false,
      pasteGraphLink: false,
      border: false,
      graphDescription: "Function Guesser player graph"
    });

    state.playerCalc.observeEvent("change", function (_eventName, event) {
      if (state.internalPlayerChanges > 0) {
        if (state.puzzle) state.scanQueued = true;
        return;
      }
      if (event && event.isUserInitiated === false && !state.puzzle) return;
      schedulePlayerScan();
    });
  }

  function rebuildPlayerCalculator() {
    if (state.playerCalc) {
      state.playerCalc.destroy();
      state.playerCalc = null;
      dom.playerCalculator.replaceChildren();
    }
    initPlayerCalculator();
  }

  function showCreateView() {
    dom.creatorView.classList.add("is-active");
    dom.playerView.classList.remove("is-active");
    dom.creatorActions.hidden = false;
    dom.playerActions.hidden = true;
    if (state.creatorCalc) state.creatorCalc.resize();
  }

  function showPlayView(hasPuzzle) {
    dom.playerView.classList.add("is-active");
    dom.creatorView.classList.remove("is-active");
    dom.creatorActions.hidden = true;
    dom.playerActions.hidden = false;
    initPlayerCalculator();
    if (!hasPuzzle) {
      dom.puzzleAuthor.textContent = "No puzzle loaded";
      setStatus(dom.playerStatus, "Open a puzzle link or create one.", "error");
    }
    if (state.playerCalc) state.playerCalc.resize();
  }

  async function handleExport() {
    dom.exportButton.disabled = true;

    try {
      const equation = await getValidatedCreatorEquation();
      const author = dom.authorInput.value.trim() || "Anonymous";
      const token = await encodePuzzle({
        equation,
        author,
        createdAt: Date.now()
      });
      const url = buildPuzzleUrl(token);

      dom.puzzleLink.value = url;
      setStatus(dom.creatorStatus, "Puzzle link ready.", "good");
    } catch (error) {
      setStatus(dom.creatorStatus, error.message || "Could not export the puzzle.", "error");
    } finally {
      dom.exportButton.disabled = false;
    }
  }

  async function getValidatedCreatorEquation() {
    const found = getCreatorFunction();
    if (!found) {
      throw new Error("Create an expression like f(x)=x^2 before exporting.");
    }

    const validation = validateStandaloneBody(found.body);
    if (!validation.ok) throw new Error(validation.message);

    const analysis = await waitForAnalysis(state.creatorCalc, found.id, 1500);
    if (analysis && analysis.isError) {
      throw new Error(analysis.errorMessage || "Desmos rejected f(x).");
    }

    return found.body;
  }

  function getCreatorFunction() {
    const expressions = state.creatorCalc.getExpressions();
    for (const expression of expressions) {
      if (!expression || expression.type === "folder" || expression.type === "text") continue;
      const body = extractFBody(expression.latex || "");
      if (body) {
        return {
          id: expression.id,
          body
        };
      }
    }
    return null;
  }

  function extractFBody(latex) {
    const match = String(latex || "")
      .trim()
      .match(/^f\s*(?:\\left)?\(\s*x\s*(?:\\right)?\)\s*=\s*(.+)$/i);
    return match ? match[1].trim() : "";
  }

  async function handleCopyLink() {
    const link = dom.puzzleLink.value.trim();
    if (!link) {
      setStatus(dom.creatorStatus, "Export a link first.", "error");
      return;
    }

    await copyText(link);
    setStatus(dom.creatorStatus, "Puzzle link copied.", "good");
  }

  function handleOpenPuzzle() {
    const link = dom.puzzleLink.value.trim();
    if (!link) {
      setStatus(dom.creatorStatus, "Export a link first.", "error");
      return;
    }
    window.location.href = link;
  }

  async function handleHashChange() {
    const token = readPuzzleToken();
    if (!token || token === state.currentToken) return;
    await openPuzzleToken(token);
  }

  async function openPuzzleToken(token) {
    showPlayView(false);
    setStatus(dom.playerStatus, "Loading puzzle.");

    try {
      const puzzle = await decodePuzzle(token);
      if (!puzzle || !puzzle.equation) {
        throw new Error("This puzzle link is missing its function.");
      }
      state.currentToken = token;
      setupPuzzle(puzzle);
      showPlayView(true);
      setStatus(dom.playerStatus, "Watching Desmos for a matching standalone function.", "good");
    } catch (error) {
      state.puzzle = null;
      showCreateView();
      setStatus(dom.creatorStatus, error.message || "This puzzle link could not be opened.", "error");
    }
  }

  function setupPuzzle(puzzle) {
    rebuildPlayerCalculator();
    closeCompletedOverlay();
    clearTimeout(state.scanTimer);

    state.puzzle = {
      equation: String(puzzle.equation || "").trim(),
      author: String(puzzle.author || "Anonymous").trim() || "Anonymous",
      createdAt: Number(puzzle.createdAt) || 0
    };
    state.sampleRows = [];
    state.checkedCandidates = 0;
    state.solvedGuess = "";
    state.solvedLabel = "";
    state.scanInProgress = false;
    state.scanQueued = false;

    dom.puzzleAuthor.textContent = `By ${state.puzzle.author}`;
    runInternalPlayerChange(() => {
      state.playerCalc.setBlank();
      state.playerCalc.setMathBounds({
        left: -8,
        right: 8,
        bottom: -6,
        top: 6
      });
      state.playerCalc.setExpression({
        id: SECRET_EXPR_ID,
        latex: `f(x)=${state.puzzle.equation}`,
        hidden: false,
        secret: true,
        color: "#1b2428"
      });
    });

    setupSampleHelpers();
    schedulePlayerScan(900);
  }

  function setupSampleHelpers() {
    state.sampleRows = SAMPLE_POINTS.map((point) => {
      const pointLatex = formatPoint(point);
      const fHelper = state.playerCalc.HelperExpression({ latex: `f(${pointLatex})` });
      const gHelper = state.playerCalc.HelperExpression({ latex: `g(${pointLatex})` });
      const row = {
        fHelper,
        gHelper,
        fValue: fHelper.numericValue,
        gValue: gHelper.numericValue
      };

      fHelper.observe("numericValue", () => {
        row.fValue = fHelper.numericValue;
      });
      gHelper.observe("numericValue", () => {
        row.gValue = gHelper.numericValue;
      });

      return row;
    });
  }

  function schedulePlayerScan(delay) {
    if (!state.puzzle || state.solvedGuess) return;
    clearTimeout(state.scanTimer);
    state.scanTimer = window.setTimeout(scanPlayerExpressions, delay || SCAN_DELAY_MS);
  }

  async function scanPlayerExpressions() {
    if (!state.puzzle || state.solvedGuess) return;
    if (state.scanInProgress) {
      state.scanQueued = true;
      return;
    }

    state.scanInProgress = true;
    state.scanQueued = false;

    try {
      const expressions = state.playerCalc.getExpressions();
      const candidates = getCandidateExpressions(expressions);

      if (candidates.length > 0) {
        setStatus(dom.playerStatus, `Checking ${candidates.length} possible ${plural(candidates.length, "guess", "guesses")}.`);
      } else {
        setStatus(dom.playerStatus, "Watching Desmos for a matching standalone function.", "good");
      }

      for (const candidate of candidates) {
        if (state.solvedGuess) break;
        const matched = await checkCandidate(candidate);
        state.checkedCandidates += 1;
        if (matched) {
          completePuzzle(candidate);
          break;
        }
      }
    } finally {
      state.scanInProgress = false;
      if (state.scanQueued && !state.solvedGuess) schedulePlayerScan(100);
    }
  }

  function getCandidateExpressions(expressions) {
    const seen = new Set();
    const candidates = [];

    for (const expression of expressions) {
      if (!isUserExpression(expression)) continue;

      const parsed = parseCandidateExpression(expression.latex || "");
      if (!parsed) continue;

      const validation = validateStandaloneBody(parsed.body);
      if (!validation.ok) continue;

      const key = validation.body.replace(/\s+/g, "");
      if (seen.has(key)) continue;
      seen.add(key);

      candidates.push({
        id: expression.id,
        body: validation.body,
        label: parsed.label
      });
    }

    return candidates;
  }

  function isUserExpression(expression) {
    return (
      expression &&
      expression.type !== "folder" &&
      expression.type !== "text" &&
      expression.id !== SECRET_EXPR_ID &&
      expression.id !== CHECK_EXPR_ID &&
      !String(expression.id || "").startsWith("__fg_") &&
      !expression.secret &&
      typeof expression.latex === "string"
    );
  }

  function parseCandidateExpression(latex) {
    const text = String(latex || "").trim();
    if (!text || text.length > MAX_FORMULA_LENGTH) return null;
    if (containsFCall(text)) return null;

    const yMatch = text.match(/^y\s*=\s*(.+)$/i);
    if (yMatch) {
      return {
        body: yMatch[1].trim(),
        label: text
      };
    }

    const functionMatch = text.match(/^([a-z])(?:_\{?[a-z0-9]+\}?)?\s*(?:\\left)?\(\s*x\s*(?:\\right)?\)\s*=\s*(.+)$/i);
    if (functionMatch && functionMatch[1].toLowerCase() !== "f") {
      return {
        body: functionMatch[2].trim(),
        label: text
      };
    }

    if (text.includes("=") || /\by\b/i.test(text)) return null;

    return {
      body: text,
      label: `y=${text}`
    };
  }

  function validateStandaloneBody(raw) {
    const body = String(raw || "").trim();

    if (!body) return invalid("Empty function.");
    if (body.length > MAX_FORMULA_LENGTH) return invalid("That function is too long.");
    if (/[=~<>]/.test(body)) return invalid("Use a single function of x.");
    if (containsFCall(body)) return invalid("Guesses must not reference f(x).");
    if (containsOnlyDisallowedSymbols(body)) {
      return invalid("Use only x and standard Desmos built-ins.");
    }

    return {
      ok: true,
      body,
      message: ""
    };
  }

  function containsOnlyDisallowedSymbols(body) {
    const words = String(body || "")
      .toLowerCase()
      .replace(/\\operatorname\s*\{([a-z]+)\}/g, " $1 ")
      .replace(/\\/g, " ")
      .match(/[a-z]+/g);

    for (const word of words || []) {
      if (!ALLOWED_WORDS.has(word)) return true;
    }

    return false;
  }

  function invalid(message) {
    return {
      ok: false,
      body: "",
      message
    };
  }

  async function checkCandidate(candidate) {
    runInternalPlayerChange(() => {
      state.playerCalc.setExpression({
        id: CHECK_EXPR_ID,
        latex: `g(x)=${candidate.body}`,
        hidden: true,
        secret: true
      });
    });

    const analysis = await waitForAnalysis(state.playerCalc, CHECK_EXPR_ID, 1600);
    if (analysis && analysis.isError) return false;

    await waitForSecretSamples(1700);
    await wait(350);

    const comparison = compareSampleRows();
    if (!comparison.ok) return false;

    candidate.matchedPoints = comparison.matchedPoints;
    candidate.maxGap = comparison.maxGap;
    return true;
  }

  function compareSampleRows() {
    let finiteSecretPoints = 0;
    let matchedPoints = 0;
    let maxGap = 0;

    for (const row of state.sampleRows) {
      const fValue = row.fValue;
      const gValue = row.gValue;
      const fFinite = isFiniteNumber(fValue);
      const gFinite = isFiniteNumber(gValue);

      if (fFinite) {
        finiteSecretPoints += 1;
        if (!gFinite) {
          return { ok: false, matchedPoints, maxGap };
        }

        const gap = Math.abs(fValue - gValue);
        const tolerance =
          MATCH_ABS_TOLERANCE + MATCH_REL_TOLERANCE * Math.max(Math.abs(fValue), Math.abs(gValue), 1);
        maxGap = Math.max(maxGap, gap);
        if (gap > tolerance) {
          return { ok: false, matchedPoints, maxGap };
        }

        matchedPoints += 1;
      } else if (gFinite) {
        return { ok: false, matchedPoints, maxGap };
      }
    }

    return {
      ok: finiteSecretPoints >= MIN_FINITE_SECRET_POINTS,
      matchedPoints,
      maxGap
    };
  }

  function completePuzzle(candidate) {
    state.solvedGuess = candidate.body;
    state.solvedLabel = candidate.label;
    setStatus(dom.playerStatus, "Completed!", "good");
    showCompletedOverlay(candidate);
  }

  function showCompletedOverlay(candidate) {
    const matchedPoints = candidate.matchedPoints || 0;
    dom.completeSummary.textContent = `Matched ${matchedPoints} sampled points from ${candidate.label}.`;
    dom.includeSpoiler.checked = false;
    updateDiscordMessage();
    dom.completeOverlay.hidden = false;
  }

  function closeCompletedOverlay() {
    dom.completeOverlay.hidden = true;
  }

  function updateDiscordMessage() {
    if (!state.puzzle) {
      dom.discordMessage.value = "";
      return;
    }

    const author = state.puzzle.author || "Anonymous";
    const lines = [
      `I solved ${author}'s Function Guesser puzzle!`,
      getCurrentPuzzleUrl(),
      `Matched automatically from: ${state.solvedLabel || "a Desmos expression"}`
    ];

    if (dom.includeSpoiler.checked) {
      lines.push(`||Solution: y = ${state.solvedGuess || state.puzzle.equation}||`);
    }

    dom.discordMessage.value = lines.join("\n");
  }

  async function handleCopyDiscord() {
    const message = dom.discordMessage.value.trim();
    if (!message) return;
    await copyText(message);
    dom.copyDiscordButton.textContent = "Copied";
    window.setTimeout(() => {
      dom.copyDiscordButton.textContent = "Copy Discord Message";
    }, 1200);
  }

  function containsFCall(input) {
    const compact = String(input || "")
      .toLowerCase()
      .replace(/\\left|\\right/g, "")
      .replace(/\s+/g, "");
    return /(^|[^a-z\\])f'*\(/.test(compact);
  }

  function waitForAnalysis(calculator, id, timeoutMs) {
    return new Promise((resolve) => {
      const start = performance.now();

      function check() {
        const analysis = calculator.expressionAnalysis && calculator.expressionAnalysis[id];
        if (analysis && typeof analysis.isError === "boolean") {
          resolve(analysis);
          return;
        }

        if (performance.now() - start >= timeoutMs) {
          resolve(analysis || null);
          return;
        }

        window.setTimeout(check, 40);
      }

      check();
    });
  }

  async function waitForSecretSamples(timeoutMs) {
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
      if (countFiniteSecretSamples() >= MIN_FINITE_SECRET_POINTS) return;
      await wait(80);
    }
  }

  function countFiniteSecretSamples() {
    return state.sampleRows.reduce((count, row) => count + (isFiniteNumber(row.fValue) ? 1 : 0), 0);
  }

  function setStatus(element, message, kind) {
    element.textContent = message || "";
    element.classList.toggle("is-error", kind === "error");
    element.classList.toggle("is-good", kind === "good");
  }

  function runInternalPlayerChange(callback) {
    state.internalPlayerChanges += 1;
    try {
      callback();
    } finally {
      window.setTimeout(() => {
        state.internalPlayerChanges = Math.max(0, state.internalPlayerChanges - 1);
        if (state.internalPlayerChanges === 0 && state.scanQueued && !state.scanInProgress && !state.solvedGuess) {
          schedulePlayerScan(100);
        }
      }, 120);
    }
  }

  function readPuzzleToken() {
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return "";
    const params = new URLSearchParams(hash);
    return params.get("play") || params.get("p") || "";
  }

  function buildPuzzleUrl(token) {
    const url = new URL(window.location.href);
    url.hash = `play=${encodeURIComponent(token)}`;
    return url.toString();
  }

  function getCurrentPuzzleUrl() {
    if (!state.currentToken) return window.location.href;
    return buildPuzzleUrl(state.currentToken);
  }

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
        await crypto.subtle.encrypt(
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
        await crypto.subtle.decrypt(
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
    return Boolean(window.crypto && crypto.subtle && crypto.getRandomValues);
  }

  async function deriveAesKey(salt) {
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      utf8Encode(APP_PEPPER),
      "PBKDF2",
      false,
      ["deriveKey"]
    );

    return crypto.subtle.deriveKey(
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
    if (window.crypto && crypto.getRandomValues) {
      crypto.getRandomValues(bytes);
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
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function base64UrlDecode(value) {
    let base64 = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) base64 += "=";
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function utf8Encode(text) {
    return new TextEncoder().encode(text);
  }

  function utf8Decode(bytes) {
    return new TextDecoder().decode(bytes);
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  function makeSamplePoints(left, right, count) {
    const points = [];
    const step = (right - left) / (count - 1);
    for (let i = 0; i < count; i += 1) {
      points.push(left + step * i);
    }
    return points;
  }

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function formatPoint(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0+$/g, "").replace(/\.$/, "");
  }

  function plural(count, singular, pluralWord) {
    return count === 1 ? singular : pluralWord;
  }

  function wait(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }
})();
