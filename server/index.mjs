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
    /"id"\s*:\s*"([^"]+)"/i,
    /\belementId=([A-Za-z0-9._:-]+)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return m[1];
  }

  try {
    const parsed = JSON.parse(text);
    return parsed?.elementId || parsed?.element_id || parsed?.id || null;
  } catch {
    return null;
  }
}

function parseStep(step) {
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

  const waitText = step.match(/wait .*?['"]([^'"]+)['"]/i);
  if (waitText) return { kind: "wait", text: waitText[1] };

  return { kind: "noop" };
}

async function runTestWithMcp({ platform, appId, test }) {
  const start = Date.now();
  const logs = [];

  if (!isNodeCompatibleForAppiumMcp()) {
    throw new Error(getNodeCompatibilityError());
  }

  const { client, transport, tools } = await connectMcp();
  logs.push(`Connected to Appium MCP (${tools.size} tools)`);

  try {
    if (tools.has("select_platform")) {
      const schema = tools.get("select_platform").inputSchema;
      const platformArg = pickArgName(schema, ["platform", "name"]);
      await callTool(client, "select_platform", {
        [platformArg || "platform"]: normalizePlatform(platform),
      });
      logs.push(`Platform selected: ${normalizePlatform(platform)}`);
    }

    if (!tools.has("create_session")) {
      throw new Error("MCP tool `create_session` is not available");
    }

    const capabilities = await loadCapabilities(platform, appId);
    const sessionSchema = tools.get("create_session").inputSchema;
    const capsArg = pickArgName(sessionSchema, ["capabilities", "desiredCapabilities"]);
    const platformArg = pickArgName(sessionSchema, ["platform", "platformName"]);
    const createArgs = {};
    if (capsArg) createArgs[capsArg] = capabilities;
    if (platformArg) createArgs[platformArg] = normalizePlatform(platform);
    if (!capsArg && !platformArg) createArgs.capabilities = capabilities;

    await callTool(client, "create_session", createArgs);
    logs.push("Session created");

    for (let i = 0; i < test.steps.length; i += 1) {
      const raw = test.steps[i];
      const step = parseStep(raw);
      logs.push(`Step ${i + 1}: ${raw}`);

      if (step.kind === "noop") {
        logs.push("  skipped (unsupported step format; expected id/a11y selectors)");
        continue;
      }

      if (step.kind === "wait") {
        if (!tools.has("appium_get_source")) {
          throw new Error("MCP tool `appium_get_source` is not available");
        }
        const source = await callTool(client, "appium_get_source", {});
        const page = parseToolText(source);
        if (!page.toLowerCase().includes(step.text.toLowerCase())) {
          throw new Error(`Text not found on screen: ${step.text}`);
        }
        logs.push(`  verified text: ${step.text}`);
        continue;
      }

      if (!tools.has("appium_find_element")) {
        throw new Error("MCP tool `appium_find_element` is not available");
      }

      const findSchema = tools.get("appium_find_element").inputSchema;
      const usingArg = pickArgName(findSchema, ["using", "strategy", "by"]);
      const valueArg = pickArgName(findSchema, ["value", "selector", "locator", "query"]);
      const findArgs = {};
      findArgs[usingArg || "using"] = step.using;
      findArgs[valueArg || "value"] = step.selector;
      const found = await callTool(client, "appium_find_element", findArgs);
      const elementId = extractElementId(found);
      if (!elementId) {
        throw new Error(`Could not resolve element id for selector "${step.selector}"`);
      }

      if (step.kind === "tap") {
        if (!tools.has("appium_click")) {
          throw new Error("MCP tool `appium_click` is not available");
        }
        const clickSchema = tools.get("appium_click").inputSchema;
        const elementArg = pickArgName(clickSchema, [
          "elementId",
          "element_id",
          "id",
          "element",
        ]);
        await callTool(client, "appium_click", { [elementArg || "elementId"]: elementId });
        logs.push("  tapped");
        continue;
      }

      if (step.kind === "type") {
        if (!tools.has("appium_type")) {
          throw new Error("MCP tool `appium_type` is not available");
        }
        const typeSchema = tools.get("appium_type").inputSchema;
        const elementArg = pickArgName(typeSchema, [
          "elementId",
          "element_id",
          "id",
          "element",
        ]);
        const textArg = pickArgName(typeSchema, ["text", "value", "keys"]);
        const typeArgs = {
          [elementArg || "elementId"]: elementId,
          [textArg || "text"]: step.value,
        };
        await callTool(client, "appium_type", typeArgs);
        logs.push("  typed");
      }
    }

    return {
      passed: true,
      logs,
      duration: Number(((Date.now() - start) / 1000).toFixed(1)),
    };
  } finally {
    try {
      if (tools.has("close_session")) {
        await callTool(client, "close_session", {});
      }
    } catch {
      // Best effort cleanup.
    }
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
      logs: [`❌ ${e.message}`],
      duration: 0,
      error: e.message,
    });
  }
});

app.listen(PORT, () => {
  process.stdout.write(`API server ready on http://127.0.0.1:${PORT}\n`);
});
