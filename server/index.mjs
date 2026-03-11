import cors from "cors";
import express from "express";
import dotenv from "dotenv";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const PORT = Number(process.env.API_PORT || 8787);
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:3b";
const APPIUM_MCP_COMMAND =
  process.env.APPIUM_MCP_COMMAND || "./node_modules/.bin/appium-mcp";
const APPIUM_CAPS_PATH = process.env.APPIUM_CAPS_PATH || "server/capabilities.example.json";
const APPIUM_SERVER_URL = process.env.APPIUM_SERVER_URL || "http://127.0.0.1:4723";
const APPIUM_MCP_MIN_NODE = "20.19.0";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
const runtimeLogs = [];
const MAX_RUNTIME_LOGS = 800;

function addRuntimeLog(message) {
  const line = `${new Date().toISOString()} ${message}`;
  runtimeLogs.push(line);
  if (runtimeLogs.length > MAX_RUNTIME_LOGS) runtimeLogs.shift();
  process.stdout.write(`${line}\n`);
}

function normalizePlatform(platform = "") {
  return /android/i.test(platform) ? "android" : "ios";
}

function parseVersion(version) {
  const clean = String(version || "").replace(/^v/, "");
  const [major, minor, patch] = clean.split(".").map((n) => Number.parseInt(n || "0", 10));
  return { major: major || 0, minor: minor || 0, patch: patch || 0 };
}

function gteVersion(actual, min) {
  if (actual.major !== min.major) return actual.major > min.major;
  if (actual.minor !== min.minor) return actual.minor > min.minor;
  return actual.patch >= min.patch;
}

function isNodeCompatibleForAppiumMcp() {
  return gteVersion(parseVersion(process.version), parseVersion(APPIUM_MCP_MIN_NODE));
}

function getNodeCompatibilityError() {
  return `Node ${process.version} is not compatible with Appium MCP in this setup. Use Node >= ${APPIUM_MCP_MIN_NODE} (recommended: 22.x).`;
}

function getServerLogTail(count = 120) {
  const n = Number.isFinite(count) ? Math.max(1, Math.min(1000, count)) : 120;
  return runtimeLogs.slice(-n).map((line) => `[server] ${line}`);
}

function parseCommand(command) {
  const parts = command.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  return parts.map((p) => p.replace(/^"|"$/g, ""));
}

async function loadCapabilities(platform, appId) {
  const filePath = path.resolve(appRoot, APPIUM_CAPS_PATH);
  const raw = await fs.readFile(filePath, "utf8");
  const json = JSON.parse(raw);
  const key = normalizePlatform(platform);
  const caps = json[key] || {};

  if (appId) {
    if (key === "ios") caps["appium:bundleId"] = appId;
    if (key === "android") caps["appium:appPackage"] = appId;
  }

  return caps;
}

function pickArgName(schema, candidates) {
  const props = schema?.properties ? Object.keys(schema.properties) : [];
  return candidates.find((c) => props.includes(c));
}

async function connectMcp() {
  const [command, ...args] = parseCommand(APPIUM_MCP_COMMAND);
  if (!command) throw new Error("APPIUM_MCP_COMMAND is empty");

  const transport = new StdioClientTransport({
    command,
    args,
    env: {
      ...process.env,
      APPIUM_BASE_URL: APPIUM_SERVER_URL,
    },
  });

  const client = new Client(
    {
      name: "apptest-suite-backend",
      version: "1.0.0",
    },
    {
      capabilities: {},
    }
  );

  await client.connect(transport);
  const list = await client.listTools();
  const tools = new Map((list?.tools || []).map((t) => [t.name, t]));

  return { client, transport, tools };
}

async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function callTool(client, name, args = {}) {
  return client.callTool({ name, arguments: args });
}

function parseToolText(result) {
  const text = (result?.content || [])
    .filter((c) => c?.type === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();
  return text;
}

function extractElementId(result) {
  const text = parseToolText(result);
  if (!text) return null;

  const patterns = [
    /"elementId"\s*:\s*"([^"]+)"/i,
    /"element_id"\s*:\s*"([^"]+)"/i,
    /"elementUUID"\s*:\s*"([^"]+)"/i,
    /"element_uuid"\s*:\s*"([^"]+)"/i,
    /"id"\s*:\s*"([^"]+)"/i,
    /\belementId=([A-Za-z0-9._:-]+)/i,
    /\belementUUID=([A-Za-z0-9._:-]+)/i,
    /Element id ([A-Za-z0-9._:-]+)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return m[1];
  }

  try {
    const parsed = JSON.parse(text);
    return (
      parsed?.elementId ||
      parsed?.element_id ||
      parsed?.elementUUID ||
      parsed?.element_uuid ||
      parsed?.id ||
      null
    );
  } catch {
    return null;
  }
}

function parseJsonFromToolText(result) {
  const text = parseToolText(result);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isVersionLike(value) {
  return /^\d+(?:\.\d+)*$/.test(String(value || "").trim());
}

function toolTextIndicatesFailure(text = "") {
  return /(tool .*execution failed|tool error|failed to |no active driver session|no driver found|must be a valid version number|invalid argument)/i.test(
    String(text)
  );
}

function assertToolResultOk(toolName, result) {
  const text = parseToolText(result);
  if (toolTextIndicatesFailure(text)) {
    throw new Error(`${toolName} returned error: ${String(text).slice(0, 260)}`);
  }
}

function parseStep(step) {
  const clean = String(step || "")
    .replace(/\s+/g, " ")
    .trim();

  if (/^\s*launch app\s*$/i.test(step)) {
    return { kind: "launch" };
  }
  if (/open (the )?(ios )?simulator/i.test(step)) {
    return { kind: "ensureSimulator" };
  }
  if (/launch (the )?app( from the home screen)?/i.test(step)) {
    return { kind: "launch" };
  }

  const tapId = step.match(/tap .*?(?:id|resource-id)\s*['"]([^'"]+)['"]/i);
  if (tapId) return { kind: "tap", using: "id", selector: tapId[1] };

  const tapA11y = step.match(/tap .*?(?:accessibility id|a11y)\s*['"]([^'"]+)['"]/i);
  if (tapA11y) return { kind: "tap", using: "accessibility id", selector: tapA11y[1] };

  const typeId = step.match(
    /type\s*['"]([^'"]+)['"].*?(?:id|resource-id)\s*['"]([^'"]+)['"]/i
  );
  if (typeId) {
    return { kind: "type", using: "id", value: typeId[1], selector: typeId[2] };
  }

  const typeA11y = step.match(
    /type\s*['"]([^'"]+)['"].*?(?:accessibility id|a11y)\s*['"]([^'"]+)['"]/i
  );
  if (typeA11y) {
    return {
      kind: "type",
      using: "accessibility id",
      value: typeA11y[1],
      selector: typeA11y[2],
    };
  }

  const sanitizeLabel = (v) =>
    String(v || "")
      .replace(/^[\s"'`]+/, "")
      .replace(/[\s"'`,]+$/, "")
      .replace(/\s+/g, " ")
      .trim();

  const tapLabel = clean.match(/tap(?: on)?(?: the)?\s+(.+?)(?:\s+(?:button|tab|field))?\s*$/i);
  if (tapLabel) return { kind: "tapLabel", label: sanitizeLabel(tapLabel[1]) };

  const typeLabel = step.match(
    /type\s*['"]([^'"]+)['"]\s*(?:in|into)?(?:\s+the)?\s+(.+?)(?:\s+(?:field|input|textbox))?\s*$/i
  );
  if (typeLabel) {
    return {
      kind: "typeLabel",
      value: typeLabel[1],
      label: sanitizeLabel(typeLabel[2]),
    };
  }

  const typeLabelBare = step.match(
    /type\s+(.+?)\s*(?:in|into)?(?:\s+the)?\s+(.+?)(?:\s+(?:field|input|textbox))?\s*$/i
  );
  if (typeLabelBare) {
    return {
      kind: "typeLabel",
      value: typeLabelBare[1].trim(),
      label: sanitizeLabel(typeLabelBare[2]),
    };
  }

  const navigateTo = clean.match(/navigate to\s+(.+?)\s*$/i);
  if (navigateTo) return { kind: "tapLabel", label: sanitizeLabel(navigateTo[1]) };

  const waitText = step.match(/wait .*?['"]([^'"]+)['"]/i);
  if (waitText) return { kind: "wait", text: waitText[1] };

  const waitSeconds = step.match(/wait\s+for\s+(\d+)\s*(second|seconds|sec|s)\b/i);
  if (waitSeconds) return { kind: "delay", seconds: Number.parseInt(waitSeconds[1], 10) };

  const waitTextBare = step.match(/wait(?:\s+for)?(?:\s+text)?\s+(.+?)\s*$/i);
  if (waitTextBare) return { kind: "wait", text: sanitizeLabel(waitTextBare[1]) };

  const verifyVisible = step.match(/verify\s+(.+?)\s+(?:is\s+)?(?:visible|shown|appears?)\s*$/i);
  if (verifyVisible) return { kind: "wait", text: sanitizeLabel(verifyVisible[1]) };

  return { kind: "noop" };
}

function includesAny(haystack, needles) {
  const h = String(haystack || "").toLowerCase();
  return needles.some((n) => h.includes(n));
}

function elementTextBlob(el) {
  return String(
    `${el?.text || ""} ${el?.contentDesc || ""} ${el?.resourceId || ""} ${el?.className || ""} ${
      el?.locators?.["accessibility id"] || ""
    } ${el?.locators?.name || ""} ${el?.locators?.id || ""}`.trim()
  ).toLowerCase();
}

function scoreGeneratedElement(el, normLabel, tokens) {
  const blob = elementTextBlob(el);
  if (!blob) return -1;

  let score = 0;
  if (blob === normLabel) score += 120;
  if (blob.includes(normLabel)) score += 60;
  for (const t of tokens) {
    if (blob.includes(t)) score += 10;
  }

  if (/\bcontinue\b/.test(normLabel) && !/\bapple\b/.test(normLabel) && /\bapple\b/.test(blob)) {
    score -= 150;
  }
  if (/\bcontinue\b/.test(normLabel) && !/\bgoogle\b/.test(normLabel) && /\bgoogle\b/.test(blob)) {
    score -= 120;
  }
  if (/\bcontinue\b/.test(normLabel) && !/\bfacebook\b/.test(normLabel) && /\bfacebook\b/.test(blob)) {
    score -= 120;
  }

  // Penalize generic containers that often cause false taps.
  if (/\b(bg|background|container|wrapper|root|screen|view)\b/.test(blob)) {
    score -= 80;
  }
  if (/\bloginbg\b/.test(blob) && !/\bloginbg\b/.test(normLabel)) {
    score -= 220;
  }
  if (/\bcodatext\b/.test(blob) && !/\bcodatext\b/.test(normLabel)) {
    score -= 180;
  }

  return score;
}

async function findByGeneratedLocatorsFirst({ label, normLabel, tools, invokeTool, usingArg, valueArg }) {
  addRuntimeLog(
    `locator:screenshot_first_start label="${label}" generate_locators=${tools.has("generate_locators")} appium_screenshot=${tools.has("appium_screenshot")}`
  );
  if (!tools.has("generate_locators")) return null;

  let elements = [];
  let rawText = "";
  let attempts = 0;
  const maxAttempts = 4;
  while (attempts < maxAttempts) {
    attempts += 1;
    if (tools.has("appium_screenshot")) {
      await invokeTool("appium_screenshot", { maxWidth: 720 });
      addRuntimeLog(`locator:screenshot_first_captured label="${label}" attempt=${attempts}`);
    } else {
      addRuntimeLog(`locator:screenshot_first_unavailable label="${label}" attempt=${attempts}`);
    }

    const locatorsResult = await invokeTool("generate_locators", {});
    const parsed = parseJsonFromToolText(locatorsResult);
    rawText = parseToolText(locatorsResult);
    elements = Array.isArray(parsed?.interactableElements) ? parsed.interactableElements : [];
    addRuntimeLog(`locator:screenshot_first_raw label="${label}" attempt=${attempts} raw="${String(rawText).slice(0, 500)}"`);
    addRuntimeLog(`locator:screenshot_first_count label="${label}" attempt=${attempts} count=${elements.length}`);

    // Launch/splash detection: only generic art layers are exposed.
    const looksLikeLaunchOnly =
      elements.length > 0 &&
      elements.every((el) => {
        const a11y = String(el?.locators?.["accessibility id"] || "").toLowerCase();
        const blob = elementTextBlob(el);
        return (
          a11y === "codatext" ||
          a11y === "loginbg" ||
          /codatext|loginbg|gradient full layer/.test(blob)
        );
      });
    if (looksLikeLaunchOnly && attempts < maxAttempts) {
      addRuntimeLog(`locator:screenshot_first_wait_launch label="${label}" attempt=${attempts}`);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      continue;
    }
    break;
  }

  if (elements.length) {
    const preview = elements
      .slice(0, 5)
      .map((el) => ({
        tag: el?.tagName || "",
        text: el?.text || "",
        contentDesc: el?.contentDesc || "",
        resourceId: el?.resourceId || "",
        a11y: el?.locators?.["accessibility id"] || "",
      }));
    addRuntimeLog(`locator:screenshot_first_preview label="${label}" data='${JSON.stringify(preview)}'`);
  }
  if (!elements.length) {
    addRuntimeLog(`locator:screenshot_first_empty label="${label}" raw="${String(rawText).slice(0, 200)}"`);
    return null;
  }

  const tokens = normLabel.split(/\s+/).filter(Boolean);
  const scored = elements
    .map((el) => ({ el, score: scoreGeneratedElement(el, normLabel, tokens) }))
    .sort((a, b) => b.score - a.score);
  const minScore = tokens.length > 1 ? 12 : 8;
  const ranked = scored.filter((x) => x.score >= minScore).map((x) => x.el);
  addRuntimeLog(
    `locator:screenshot_first_scored label="${label}" top=${scored.length ? scored[0].score : -1} qualified=${ranked.length}`
  );
  if (!ranked.length) {
    addRuntimeLog(`locator:screenshot_first_low_confidence label="${label}"`);
    return null;
  }

  const strategyOrder = [
    "accessibility id",
    "id",
    "name",
    "class name",
    "-ios predicate string",
    "-android uiautomator",
    "-ios class chain",
    "xpath",
    "css selector",
  ];

  for (const el of ranked) {
    const loc = el?.locators || {};
    for (const strategy of strategyOrder) {
      const selector = loc[strategy];
      if (!selector) continue;
      try {
        const findArgs = {
          [usingArg || "using"]: strategy,
          [valueArg || "value"]: selector,
        };
        const found = await invokeTool("appium_find_element", findArgs);
        const elementId = extractElementId(found);
        if (elementId) {
          addRuntimeLog(
            `locator:screenshot_first_match label="${label}" strategy="${strategy}" selector="${String(selector).slice(0, 120)}"`
          );
          return elementId;
        }
      } catch {
        // keep scanning
      }
    }
  }

  addRuntimeLog(`locator:screenshot_first_no_match label="${label}"`);
  return null;
}

async function findElementByLabel({ client, tools, label, invokeTool = callTool }) {
  const normalizedLabel = String(label || "")
    .replace(/^[\s"'`]+/, "")
    .replace(/[\s"'`,]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  addRuntimeLog(`locator:label_lookup_start label="${normalizedLabel}"`);
  if (!tools.has("appium_find_element")) {
    throw new Error("MCP tool `appium_find_element` is not available");
  }

  const findSchema = tools.get("appium_find_element").inputSchema;
  const usingArg = pickArgName(findSchema, ["using", "strategy", "by"]);
  const valueArg = pickArgName(findSchema, ["value", "selector", "locator", "query"]);

  const normLabel = normalizedLabel.toLowerCase();
  try {
    const fromScreenshot = await findByGeneratedLocatorsFirst({
      label: normalizedLabel,
      normLabel,
      tools,
      invokeTool,
      usingArg,
      valueArg,
    });
    if (fromScreenshot) return fromScreenshot;
  } catch (e) {
    addRuntimeLog(`locator:screenshot_first_failed label="${normalizedLabel}" err="${e?.message || "unknown"}"`);
  }

  const attempts = [
    { using: "accessibility id", value: normalizedLabel },
    { using: "id", value: normalizedLabel.replace(/\s+/g, "_").toLowerCase() },
    {
      using: "xpath",
      value:
        `//*[contains(translate(@label,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'${normLabel}')` +
        ` or contains(translate(@name,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'${normLabel}')` +
        ` or contains(translate(@text,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'${normLabel}')]`,
    },
  ];

  // Heuristic fallbacks for common auth fields when natural labels are used.
  if (/\b(email|e-mail|username|user)\b/.test(normLabel)) {
    attempts.push({ using: "class name", value: "XCUIElementTypeTextField" });
    attempts.push({ using: "class name", value: "android.widget.EditText" });
    attempts.push({
      using: "xpath",
      value:
        "(//XCUIElementTypeTextField)[1] | (//android.widget.EditText)[1] | (//input[contains(@type,'text')])[1]",
    });
  }
  if (/\b(password|passcode|pin)\b/.test(normLabel)) {
    attempts.push({ using: "class name", value: "XCUIElementTypeSecureTextField" });
    attempts.push({ using: "class name", value: "android.widget.EditText" });
    attempts.push({
      using: "xpath",
      value:
        "(//XCUIElementTypeSecureTextField)[1] | (//android.widget.EditText)[2] | (//input[contains(@type,'password')])[1]",
    });
  }
  if (/\b(login|log in|sign in|continue|next|submit)\b/.test(normLabel)) {
    attempts.push({
      using: "xpath",
      value:
        "//*[contains(translate(@label,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'login') or " +
        "contains(translate(@name,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'login') or " +
        "contains(translate(@text,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'login') or " +
        "contains(translate(@label,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'sign in') or " +
        "contains(translate(@text,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'continue')]",
    });
  }
  if (/\balready have account\b/.test(normLabel) || /\blog in\b/.test(normLabel)) {
    attempts.unshift({
      using: "xpath",
      value:
        "//*[contains(translate(@label,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'already have account') or " +
        "contains(translate(@name,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'already have account') or " +
        "contains(translate(@text,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'already have account') or " +
        "contains(translate(@label,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'log in') or " +
        "contains(translate(@name,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'log in') or " +
        "contains(translate(@text,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'log in')]",
    });
  }

  for (const attempt of attempts) {
    try {
      const findArgs = {
        [usingArg || "using"]: attempt.using,
        [valueArg || "value"]: attempt.value,
      };
      const found = await invokeTool("appium_find_element", findArgs);
      const elementId = extractElementId(found);
      if (elementId) {
        addRuntimeLog(
          `locator:label_lookup_hit label="${label}" strategy="${attempt.using}" selector="${String(attempt.value).slice(0, 120)}"`
        );
        return elementId;
      }
    } catch {
      // Try the next locator strategy.
    }
  }
  addRuntimeLog(`locator:label_lookup_base_miss label="${normalizedLabel}"`);
  addRuntimeLog(`locator:label_lookup_no_match label="${normalizedLabel}"`);
  return null;
}

async function runTestWithMcp({ platform, appId, test }) {
  const start = Date.now();
  const runtimeLogStart = runtimeLogs.length;
  const logs = [];
  const normalizedPlatform = normalizePlatform(platform);
  addRuntimeLog(`run-test:start platform=${normalizedPlatform} appId=${appId || "n/a"} test="${test?.name || "Unnamed"}"`);

  if (!isNodeCompatibleForAppiumMcp()) {
    throw new Error(getNodeCompatibilityError());
  }

  const { client, transport, tools } = await connectMcp();
  addRuntimeLog(`mcp:connected tools=${tools.size}`);
  logs.push(`Connected to Appium MCP (${tools.size} tools)`);

  try {
    if (tools.has("select_platform")) {
      const schema = tools.get("select_platform").inputSchema;
      const platformArg = pickArgName(schema, ["platform", "name"]);
      await callTool(client, "select_platform", {
        [platformArg || "platform"]: normalizedPlatform,
      });
      addRuntimeLog(`mcp:select_platform ${normalizedPlatform}`);
      logs.push(`Platform selected: ${normalizedPlatform}`);
    }

    if (!tools.has("create_session")) {
      throw new Error("MCP tool `create_session` is not available");
    }

    const capabilities = await loadCapabilities(platform, appId);
    const configuredUdid = capabilities["appium:udid"];
    const resolvedAppId =
      appId ||
      capabilities["appium:bundleId"] ||
      capabilities["appium:appPackage"] ||
      null;

    if (
      normalizedPlatform === "ios" &&
      configuredUdid &&
      configuredUdid !== "REPLACE_WITH_SIMULATOR_OR_DEVICE_UDID" &&
      tools.has("select_device")
    ) {
      const selectSchema = tools.get("select_device").inputSchema;
      const selectPlatformArg = pickArgName(selectSchema, ["platform"]);
      const iosTypeArg = pickArgName(selectSchema, ["iosDeviceType"]);
      const udidArg = pickArgName(selectSchema, ["deviceUdid", "udid"]);
      const deviceType =
        /simulator/i.test(platform) || /simulator/i.test(String(capabilities["appium:deviceName"]))
          ? "simulator"
          : "real";
      const selectArgs = {
        [selectPlatformArg || "platform"]: "ios",
        [iosTypeArg || "iosDeviceType"]: deviceType,
        [udidArg || "deviceUdid"]: configuredUdid,
      };
      const selected = await callTool(client, "select_device", selectArgs);
      const selectedData = parseJsonFromToolText(selected);
      const selectedVersion =
        selectedData?.selectedDevice?.platformVersion ||
        selectedData?.selectedDevice?.version ||
        selectedData?.selectedDevice?.osVersion ||
        selectedData?.selectedDevice?.platform ||
        selectedData?.platformVersion ||
        selectedData?.platform ||
        selectedData?.value?.platformVersion ||
        selectedData?.value?.platform ||
        null;
      const selectedName =
        selectedData?.selectedDevice?.name ||
        selectedData?.name ||
        selectedData?.value?.name ||
        null;
      if (selectedVersion && isVersionLike(selectedVersion)) {
        capabilities["appium:platformVersion"] = String(selectedVersion).trim();
      } else if (selectedVersion) {
        addRuntimeLog(
          `mcp:select_device invalid_platform_version value="${String(selectedVersion).slice(0, 80)}" keeping="${String(
            capabilities["appium:platformVersion"] || ""
          )}"`
        );
      }
      if (selectedName && String(selectedName).trim()) {
        capabilities["appium:deviceName"] = String(selectedName).trim();
      }
      addRuntimeLog(`mcp:select_device udid=${configuredUdid} type=${deviceType}`);
      logs.push(`Device selected: ${configuredUdid} (${deviceType})`);
    }

    if (
      normalizedPlatform === "ios" &&
      configuredUdid &&
      configuredUdid !== "REPLACE_WITH_SIMULATOR_OR_DEVICE_UDID" &&
      (/simulator/i.test(platform) ||
        /simulator/i.test(String(capabilities["appium:deviceName"]))) &&
      tools.has("boot_simulator")
    ) {
      await callTool(client, "boot_simulator", { udid: configuredUdid });
      addRuntimeLog(`mcp:boot_simulator udid=${configuredUdid}`);
      logs.push(`Simulator boot requested: ${configuredUdid}`);
    }

    if (
      normalizedPlatform === "ios" &&
      (!configuredUdid || configuredUdid === "REPLACE_WITH_SIMULATOR_OR_DEVICE_UDID")
    ) {
      logs.push(
        "⚠️ Missing valid iOS UDID in capabilities. Set appium:udid in server/capabilities.example.json"
      );
    }

    capabilities["appium:autoLaunch"] =
      capabilities["appium:autoLaunch"] === undefined ? true : capabilities["appium:autoLaunch"];
    capabilities["appium:forceAppLaunch"] =
      capabilities["appium:forceAppLaunch"] === undefined
        ? true
        : capabilities["appium:forceAppLaunch"];
    capabilities["appium:usePrebuiltWDA"] =
      capabilities["appium:usePrebuiltWDA"] === undefined
        ? false
        : capabilities["appium:usePrebuiltWDA"];

    if (normalizedPlatform === "ios") {
      if (tools.has("setup_wda")) {
        try {
          await callTool(client, "setup_wda", {});
          addRuntimeLog("mcp:setup_wda ok");
          logs.push("WDA setup completed");
        } catch (e) {
          addRuntimeLog(`mcp:setup_wda failed=${e?.message || "unknown"}`);
          logs.push(`⚠️ WDA setup failed: ${e?.message || "unknown error"}`);
        }
      }
      if (tools.has("install_wda")) {
        try {
          await callTool(client, "install_wda", {});
          addRuntimeLog("mcp:install_wda ok");
          logs.push("WDA install completed");
        } catch (e) {
          addRuntimeLog(`mcp:install_wda failed=${e?.message || "unknown"}`);
          logs.push(`⚠️ WDA install failed: ${e?.message || "unknown error"}`);
        }
      }
    }

    const sessionSchema = tools.get("create_session").inputSchema;
    const capsArg = pickArgName(sessionSchema, ["capabilities", "desiredCapabilities"]);
    const platformArg = pickArgName(sessionSchema, ["platform", "platformName"]);
    const createArgs = {};
    if (capsArg) createArgs[capsArg] = capabilities;
    if (platformArg) createArgs[platformArg] = normalizedPlatform;
    if (!capsArg && !platformArg) createArgs.capabilities = capabilities;

    const recreateSession = async (reason = "unknown") => {
      addRuntimeLog(`mcp:recreate_session:start reason="${String(reason).slice(0, 180)}"`);
      const recreateResult = await callTool(client, "create_session", createArgs);
      assertToolResultOk("create_session", recreateResult);
      addRuntimeLog("mcp:recreate_session:created");
      if (tools.has("appium_activate_app") && resolvedAppId) {
        const activateResult = await callTool(client, "appium_activate_app", { id: resolvedAppId });
        assertToolResultOk("appium_activate_app", activateResult);
        addRuntimeLog(`mcp:recreate_session:activate_app id=${resolvedAppId}`);
      }
    };

    const shouldDetectSessionLoss = (toolName) =>
      ["appium_find_element", "generate_locators", "appium_get_source", "appium_screenshot"].includes(
        toolName
      );

    const callWithSessionRecovery = async (toolName, args = {}) => {
      const isNoSessionMessage = (msg) =>
        /no active driver session|please create a session first|no driver found/i.test(String(msg || ""));
      const runCall = () => callTool(client, toolName, args);
      try {
        const result = await runCall();
        if (shouldDetectSessionLoss(toolName)) {
          const text = parseToolText(result);
          if (isNoSessionMessage(text)) {
            addRuntimeLog(`mcp:session_lost tool=${toolName} mode=result_text`);
            logs.push(`⚠️ Session lost during ${toolName}. Recreating session...`);
            await recreateSession(text);
            const retried = await runCall();
            addRuntimeLog(`mcp:session_recovered retry_tool=${toolName}`);
            return retried;
          }
        }
        return result;
      } catch (e) {
        const msg = e?.message || String(e);
        if (isNoSessionMessage(msg)) {
          addRuntimeLog(`mcp:session_lost tool=${toolName} mode=exception`);
          logs.push(`⚠️ Session lost during ${toolName}. Recreating session...`);
          await recreateSession(msg);
          const retried = await runCall();
          addRuntimeLog(`mcp:session_recovered retry_tool=${toolName}`);
          return retried;
        }
        throw e;
      }
    };

    const createResult = await callTool(client, "create_session", createArgs);
    assertToolResultOk("create_session", createResult);
    addRuntimeLog("mcp:create_session ok");
    logs.push("Session created");

    if (tools.has("appium_activate_app") && resolvedAppId) {
      const activateResult = await callWithSessionRecovery("appium_activate_app", { id: resolvedAppId });
      assertToolResultOk("appium_activate_app", activateResult);
      addRuntimeLog(`mcp:activate_app id=${resolvedAppId}`);
      logs.push(`App activated: ${resolvedAppId}`);
    } else if (!resolvedAppId) {
      logs.push("⚠️ No app id resolved. Set Bundle/App ID in UI or capabilities config.");
    }

    for (let i = 0; i < test.steps.length; i += 1) {
      const raw = test.steps[i];
      const step = parseStep(raw);
      logs.push(`Step ${i + 1}: ${raw}`);
      addRuntimeLog(`step:${i + 1} parsed=${step.kind} raw="${raw}"`);

      if (step.kind === "noop") {
        logs.push("  skipped (unsupported step format; expected id/a11y selectors)");
        addRuntimeLog(`step:${i + 1} skipped=unsupported`);
        continue;
      }

      if (step.kind === "ensureSimulator") {
        if (
          normalizedPlatform === "ios" &&
          configuredUdid &&
          configuredUdid !== "REPLACE_WITH_SIMULATOR_OR_DEVICE_UDID" &&
          tools.has("boot_simulator")
        ) {
          await callWithSessionRecovery("boot_simulator", { udid: configuredUdid });
          logs.push(`  simulator ensured: ${configuredUdid}`);
          addRuntimeLog(`step:${i + 1} simulator=booted udid=${configuredUdid}`);
        } else {
          logs.push("  simulator step acknowledged (missing UDID or non-iOS)");
          addRuntimeLog(`step:${i + 1} simulator=acknowledged_without_boot`);
        }
        continue;
      }

      if (step.kind === "launch") {
        if (tools.has("appium_activate_app") && resolvedAppId) {
          await callWithSessionRecovery("appium_activate_app", { id: resolvedAppId });
          logs.push(`  app launched/activated: ${resolvedAppId}`);
          addRuntimeLog(`step:${i + 1} launch=activated id=${resolvedAppId}`);
          continue;
        }
        logs.push("  app already launched via session creation");
        addRuntimeLog(`step:${i + 1} launch=already_launched`);
        continue;
      }

      if (step.kind === "wait") {
        const sourceToolName = tools.has("appium_get_source")
          ? "appium_get_source"
          : tools.has("appium_get_page_source")
            ? "appium_get_page_source"
            : null;
        if (!sourceToolName) {
          throw new Error("MCP source tool is not available (expected appium_get_source or appium_get_page_source)");
        }
        const source = await callWithSessionRecovery(sourceToolName, {});
        const page = parseToolText(source);
        if (!page.toLowerCase().includes(step.text.toLowerCase())) {
          throw new Error(`Text not found on screen: ${step.text}`);
        }
        logs.push(`  verified text: ${step.text}`);
        addRuntimeLog(`step:${i + 1} wait=verified text="${step.text}"`);
        continue;
      }

      if (step.kind === "delay") {
        const ms = Math.max(0, Number(step.seconds || 0)) * 1000;
        if (ms > 0) {
          await new Promise((resolve) => setTimeout(resolve, ms));
        }
        logs.push(`  waited ${Number(step.seconds || 0)}s`);
        addRuntimeLog(`step:${i + 1} delay=${Number(step.seconds || 0)}s`);
        continue;
      }

      let elementId = null;
      if (step.kind === "tapLabel" || step.kind === "typeLabel") {
        elementId = await findElementByLabel({
          client,
          tools,
          label: step.label,
          invokeTool: callWithSessionRecovery,
        });
      } else {
        if (!tools.has("appium_find_element")) {
          throw new Error("MCP tool `appium_find_element` is not available");
        }
        const findSchema = tools.get("appium_find_element").inputSchema;
        const usingArg = pickArgName(findSchema, ["using", "strategy", "by"]);
        const valueArg = pickArgName(findSchema, ["value", "selector", "locator", "query"]);
        const findArgs = {};
        findArgs[usingArg || "using"] = step.using;
        findArgs[valueArg || "value"] = step.selector;
        const found = await callWithSessionRecovery("appium_find_element", findArgs);
        elementId = extractElementId(found);
        if (!elementId && step.selector) {
          addRuntimeLog(`step:${i + 1} selector_lookup_failed fallback_label="${step.selector}"`);
          elementId = await findElementByLabel({
            client,
            tools,
            label: step.selector,
            invokeTool: callWithSessionRecovery,
          });
        }
      }
      if (!elementId) {
        throw new Error(
          step.selector
            ? `Could not resolve element id for selector "${step.selector}"`
            : `Could not resolve element id for label "${step.label}"`
        );
      }

      if (step.kind === "tap" || step.kind === "tapLabel") {
        if (!tools.has("appium_click")) {
          throw new Error("MCP tool `appium_click` is not available");
        }
        const clickSchema = tools.get("appium_click").inputSchema;
        const elementArg = pickArgName(clickSchema, [
          "elementId",
          "element_id",
          "elementUUID",
          "element_uuid",
          "id",
          "element",
          "uuid",
        ]);
        await callWithSessionRecovery("appium_click", { [elementArg || "elementId"]: elementId });
        logs.push("  tapped");
        addRuntimeLog(`step:${i + 1} action=tap`);
        continue;
      }

      if (step.kind === "type" || step.kind === "typeLabel") {
        const typeToolName = tools.has("appium_type")
          ? "appium_type"
          : tools.has("appium_set_value")
            ? "appium_set_value"
            : null;
        if (!typeToolName) {
          throw new Error("MCP text input tool is not available (expected appium_type or appium_set_value)");
        }
        const typeSchema = tools.get(typeToolName).inputSchema;
        const elementArg = pickArgName(typeSchema, [
          "elementId",
          "element_id",
          "elementUUID",
          "element_uuid",
          "id",
          "element",
          "uuid",
        ]);
        const textArg = pickArgName(typeSchema, ["text", "value", "keys"]);
        const typeArgs = {
          [elementArg || "elementId"]: elementId,
          [textArg || "text"]: step.value,
        };
        await callWithSessionRecovery(typeToolName, typeArgs);
        logs.push("  typed");
        addRuntimeLog(`step:${i + 1} action=type tool=${typeToolName}`);
      }
    }
    const serverRunLogs = runtimeLogs.slice(runtimeLogStart).map((l) => `[server] ${l}`);
    return {
      passed: true,
      logs: [...logs, ...serverRunLogs],
      duration: Number(((Date.now() - start) / 1000).toFixed(1)),
    };
  } finally {
    try {
      if (tools.has("delete_session")) {
        await callTool(client, "delete_session", {});
      } else if (tools.has("close_session")) {
        await callTool(client, "close_session", {});
      }
    } catch {
      // Best effort cleanup.
    }
    addRuntimeLog("mcp:transport_close");
    await transport.close();
  }
}

async function callOllamaGenerate({ prompt, platform, model, ollamaUrl }) {
  const res = await fetch(`${ollamaUrl.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model || OLLAMA_MODEL,
      stream: false,
      messages: [
        {
          role: "user",
          content: `You are a mobile QA engineer. Generate test cases for the following app feature using Appium MCP on ${platform}.\n\nFeature/App description: ${prompt}\n\nReturn ONLY a JSON array of test cases. Each test case must have:\n- name (string)\n- category (string, e.g. Auth/Music/Search/Navigation)\n- steps (array of strings, each step should use concrete selectors like "Tap element by id 'login_btn'" or "Type 'abc' into element by accessibility id 'Email field'")\n- expected (string)\n\nReturn only valid JSON, no markdown, no explanation.`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const raw = data?.message?.content || "[]";
  const clean = raw.replace(/```json|```/g, "").trim();
  const tests = JSON.parse(clean);
  if (!Array.isArray(tests)) throw new Error("Ollama response is not a JSON array");
  return tests;
}

async function callOllamaChatCommand({ message, tests, platform, model, ollamaUrl }) {
  const compactTests = (tests || []).slice(0, 200).map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    status: t.status,
  }));

  const prompt = `You are a command router for a mobile test app.
Convert the user message into ONE JSON object only.

Allowed actions:
- {"action":"run_all"}
- {"action":"run_test","testName":"exact or partial test name"}
- {"action":"run_category","category":"Auth|Music|Search|..."}
- {"action":"generate_tests","featurePrompt":"what to generate"}
- {"action":"infra_check"}
- {"action":"help"}

Rules:
- Return JSON only, no markdown.
- Keep keys exactly as shown above.
- If unclear, return {"action":"help"}.

Current platform: ${platform}
Available tests:
${JSON.stringify(compactTests)}

User message:
${message}`;

  const res = await fetch(`${ollamaUrl.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model || OLLAMA_MODEL,
      stream: false,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama command routing failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const raw = data?.message?.content || '{"action":"help"}';
  const clean = raw.replace(/```json|```/g, "").trim();
  const cmd = JSON.parse(clean);
  if (!cmd?.action) return { action: "help" };
  return cmd;
}

async function callOllamaSingleTestInstruction({ message, platform, appId, model, ollamaUrl }) {
  const prompt = `You are a senior mobile QA automation engineer.
Convert the user request into ONE executable mobile test case for Appium MCP.

Return ONLY valid JSON object with this exact shape:
{
  "name": "string",
  "category": "string",
  "steps": ["string", "..."],
  "expected": "string"
}

Rules:
- Steps must be executable actions.
- Prefer natural visible UI references:
  - Tap on <visible button/tab/field label>
  - Type '<value>' into <visible field label>
  - Wait for text '<visible text>'
- Use id/accessibility-id selectors only when explicitly known from user request.
- Do not invent selectors like "ToolList", "btn123", or random IDs.
- Keep steps concise and deterministic.
- No markdown, no explanation.

Target platform: ${platform}
Target app id: ${appId || "unknown"}
User request: ${message}`;

  const res = await fetch(`${ollamaUrl.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model || OLLAMA_MODEL,
      stream: false,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama test planning failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const raw = data?.message?.content || "{}";
  const clean = raw.replace(/```json|```/g, "").trim();
  const test = JSON.parse(clean);
  if (!test?.name || !Array.isArray(test?.steps) || !test?.expected) {
    throw new Error("AI output is not a valid test object");
  }
  return {
    name: String(test.name),
    category: String(test.category || "AI Chat"),
    steps: test.steps.map((s) => String(s)),
    expected: String(test.expected),
  };
}

app.get("/api/health", async (_req, res) => {
  const status = {
    api: "ok",
    ollama: "down",
    appiumMcp: "down",
    details: {
      node: process.version,
      appiumMcpMinNode: APPIUM_MCP_MIN_NODE,
      appiumMcpCommand: APPIUM_MCP_COMMAND,
    },
  };

  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`);
    status.ollama = r.ok ? "up" : "down";
  } catch (e) {
    status.details.ollama = e.message;
  }

  if (!isNodeCompatibleForAppiumMcp()) {
    status.details.appiumMcp = getNodeCompatibilityError();
  } else {
    try {
      const { transport, tools } = await withTimeout(connectMcp(), 4000, "Appium MCP check");
      status.appiumMcp = "up";
      status.details.tools = tools.size;
      await transport.close();
    } catch (e) {
      status.details.appiumMcp = e.message;
    }
  }

  res.json(status);
});

app.get("/api/logs", (req, res) => {
  const tail = Number.parseInt(String(req.query.tail || "200"), 10);
  const count = Number.isFinite(tail) ? Math.min(Math.max(tail, 1), 1000) : 200;
  res.json({ logs: runtimeLogs.slice(-count) });
});

app.post("/api/generate-tests", async (req, res) => {
  try {
    const { prompt, platform, model, ollamaUrl } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "Missing prompt" });
    const tests = await callOllamaGenerate({
      prompt,
      platform: platform || "iOS Simulator",
      model,
      ollamaUrl: ollamaUrl || OLLAMA_URL,
    });
    return res.json({ tests });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.post("/api/chat-command", async (req, res) => {
  try {
    const { message, tests, platform, model, ollamaUrl } = req.body || {};
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: "Missing message" });
    }
    const command = await callOllamaChatCommand({
      message: String(message),
      tests: Array.isArray(tests) ? tests : [],
      platform: platform || "iOS Simulator",
      model,
      ollamaUrl: ollamaUrl || OLLAMA_URL,
    });
    return res.json({ command });
  } catch (e) {
    return res.status(500).json({ error: e.message, command: { action: "help" } });
  }
});

app.post("/api/chat-agent-run", async (req, res) => {
  try {
    const { message, platform, appId, model, ollamaUrl } = req.body || {};
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: "Missing message" });
    }

    const generatedTest = await callOllamaSingleTestInstruction({
      message: String(message),
      platform: platform || "iOS Simulator",
      appId: appId || "",
      model,
      ollamaUrl: ollamaUrl || OLLAMA_URL,
    });

    const result = await runTestWithMcp({
      test: { ...generatedTest },
      platform: platform || "iOS Simulator",
      appId: appId || "",
    });

    return res.json({ test: generatedTest, result });
  } catch (e) {
    return res.status(500).json({
      error: e.message,
      logs: getServerLogTail(160),
    });
  }
});

app.post("/api/run-test", async (req, res) => {
  const { test, platform, appId } = req.body || {};
  if (!test?.steps?.length) {
    return res.status(400).json({ error: "Missing test payload" });
  }

  try {
    const result = await runTestWithMcp({ test, platform, appId });
    return res.json(result);
  } catch (e) {
    return res.status(500).json({
      passed: false,
      logs: [`❌ ${e.message}`, ...getServerLogTail(200)],
      duration: 0,
      error: e.message,
    });
  }
});

app.listen(PORT, () => {
  addRuntimeLog(`API server ready on http://127.0.0.1:${PORT}`);
});
