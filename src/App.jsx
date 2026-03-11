import { useMemo, useRef, useState } from "react";

const APPIUM_MCP_URL = "https://github.com/appium/appium-mcp";

const STATUS = {
  idle: "idle",
  running: "running",
  passed: "passed",
  failed: "failed",
  skipped: "skipped",
};

const statusColors = {
  idle: "#4b5563",
  running: "#f59e0b",
  passed: "#10b981",
  failed: "#ef4444",
  skipped: "#6b7280",
};

const statusIcons = {
  idle: "○",
  running: "⟳",
  passed: "✓",
  failed: "✕",
  skipped: "—",
};

const PLATFORMS = [
  "iOS Simulator",
  "Android Emulator",
  "Physical iOS",
  "Physical Android",
];

const SAMPLE_TESTS = [
  {
    id: 1,
    name: "Login with valid credentials",
    category: "Auth",
    steps: [
      "Launch app",
      "Tap on email field",
      "Type 'user@test.com'",
      "Tap on password field",
      "Type 'password123'",
      "Tap Login button",
      "Verify home screen is visible",
    ],
    expected: "User is logged in and home screen is displayed",
    status: STATUS.idle,
    logs: [],
    duration: null,
  },
  {
    id: 2,
    name: "Login with invalid credentials",
    category: "Auth",
    steps: [
      "Launch app",
      "Tap on email field",
      "Type 'wrong@test.com'",
      "Tap on password field",
      "Type 'wrongpass'",
      "Tap Login button",
      "Verify error message is shown",
    ],
    expected: "Error message 'Invalid credentials' is displayed",
    status: STATUS.idle,
    logs: [],
    duration: null,
  },
  {
    id: 3,
    name: "Play a song",
    category: "Music",
    steps: [
      "Login to app",
      "Navigate to Library",
      "Tap on first song",
      "Verify song starts playing",
      "Verify play button changes to pause",
    ],
    expected: "Song plays and UI reflects playing state",
    status: STATUS.idle,
    logs: [],
    duration: null,
  },
  {
    id: 4,
    name: "Skip to next song",
    category: "Music",
    steps: [
      "Play a song",
      "Tap the Next button",
      "Verify song title changes",
      "Verify new song starts playing",
    ],
    expected: "Next song plays automatically",
    status: STATUS.idle,
    logs: [],
    duration: null,
  },
  {
    id: 5,
    name: "Previous song",
    category: "Music",
    steps: [
      "Play a song",
      "Skip to next song",
      "Tap the Previous button",
      "Verify original song resumes",
    ],
    expected: "Previous song resumes playing",
    status: STATUS.idle,
    logs: [],
    duration: null,
  },
  {
    id: 6,
    name: "Pause and resume playback",
    category: "Music",
    steps: [
      "Play a song",
      "Tap Pause button",
      "Verify song pauses",
      "Tap Play button",
      "Verify song resumes from same position",
    ],
    expected: "Song pauses and resumes correctly",
    status: STATUS.idle,
    logs: [],
    duration: null,
  },
  {
    id: 7,
    name: "Search for a song",
    category: "Search",
    steps: [
      "Login to app",
      "Tap Search tab",
      "Type 'Blinding Lights' in search field",
      "Verify results appear",
      "Tap on the result",
      "Verify song plays",
    ],
    expected: "Search returns correct results and song plays",
    status: STATUS.idle,
    logs: [],
    duration: null,
  },
  {
    id: 8,
    name: "Logout flow",
    category: "Auth",
    steps: [
      "Login to app",
      "Tap Profile tab",
      "Tap Logout button",
      "Confirm logout in dialog",
      "Verify login screen is shown",
    ],
    expected: "User is logged out and login screen appears",
    status: STATUS.idle,
    logs: [],
    duration: null,
  },
];

function Badge({ status }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.5,
        background: `${statusColors[status]}22`,
        color: statusColors[status],
        border: `1px solid ${statusColors[status]}44`,
      }}
    >
      <span style={{ fontSize: 13 }}>{statusIcons[status]}</span>
      {status.toUpperCase()}
    </span>
  );
}

function BugForm({ test, onSave, onClose }) {
  const [form, setForm] = useState({
    title: `[${test.category}] ${test.name} - Failed`,
    severity: "High",
    priority: "P1",
    platform: "iOS Simulator",
    description: `Test "${test.name}" failed.\n\nSteps to Reproduce:\n${test.steps
      .map((s, i) => `${i + 1}. ${s}`)
      .join("\n")}\n\nExpected Result:\n${test.expected}\n\nActual Result:\n[Describe what actually happened]`,
    environment: "iOS 17.2 / iPhone 15 Pro Simulator",
    assignee: "",
    tags: "regression, automated",
  });

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          background: "#111827",
          border: "1px solid #1f2937",
          borderRadius: 16,
          width: "100%",
          maxWidth: 620,
          maxHeight: "90vh",
          overflowY: "auto",
          padding: 28,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 24,
          }}
        >
          <h2 style={{ color: "#f9fafb", fontSize: 18, fontWeight: 700, margin: 0 }}>
            🐛 New Bug Report
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#6b7280",
              cursor: "pointer",
              fontSize: 20,
            }}
          >
            ✕
          </button>
        </div>

        {[
          { label: "Bug Title", key: "title", type: "input" },
          { label: "Description / Steps", key: "description", type: "textarea" },
          { label: "Environment", key: "environment", type: "input" },
          {
            label: "Assignee",
            key: "assignee",
            type: "input",
            placeholder: "team member name or email",
          },
          { label: "Tags", key: "tags", type: "input", placeholder: "comma separated" },
        ].map(({ label, key, type, placeholder }) => (
          <div key={key} style={{ marginBottom: 16 }}>
            <label
              style={{
                display: "block",
                color: "#9ca3af",
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 6,
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              {label}
            </label>
            {type === "textarea" ? (
              <textarea
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                rows={7}
                placeholder={placeholder}
                style={{
                  width: "100%",
                  background: "#1f2937",
                  border: "1px solid #374151",
                  borderRadius: 8,
                  padding: "10px 12px",
                  color: "#f9fafb",
                  fontSize: 13,
                  resize: "vertical",
                  fontFamily: "monospace",
                  boxSizing: "border-box",
                }}
              />
            ) : (
              <input
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                placeholder={placeholder}
                style={{
                  width: "100%",
                  background: "#1f2937",
                  border: "1px solid #374151",
                  borderRadius: 8,
                  padding: "10px 12px",
                  color: "#f9fafb",
                  fontSize: 13,
                  boxSizing: "border-box",
                }}
              />
            )}
          </div>
        ))}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 12,
            marginBottom: 20,
          }}
        >
          {[
            { label: "Severity", key: "severity", options: ["Critical", "High", "Medium", "Low"] },
            { label: "Priority", key: "priority", options: ["P0", "P1", "P2", "P3"] },
            { label: "Platform", key: "platform", options: PLATFORMS },
          ].map(({ label, key, options }) => (
            <div key={key}>
              <label
                style={{
                  display: "block",
                  color: "#9ca3af",
                  fontSize: 12,
                  fontWeight: 600,
                  marginBottom: 6,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                {label}
              </label>
              <select
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                style={{
                  width: "100%",
                  background: "#1f2937",
                  border: "1px solid #374151",
                  borderRadius: 8,
                  padding: "10px 12px",
                  color: "#f9fafb",
                  fontSize: 13,
                }}
              >
                {options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "1px solid #374151",
              background: "none",
              color: "#9ca3af",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(form)}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "none",
              background: "#ef4444",
              color: "white",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            🐛 Log Bug
          </button>
        </div>
      </div>
    </div>
  );
}

function AIGenerateModal({ onGenerate, onClose, ollamaBaseUrl, ollamaModel, apiBaseUrl }) {
  const [prompt, setPrompt] = useState("");
  const [platform, setPlatform] = useState("iOS Simulator");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const generate = async () => {
    if (!prompt.trim()) return;
    if (!ollamaBaseUrl?.trim()) {
      setError("Set your Ollama base URL in the top bar before generating.");
      return;
    }
    if (!ollamaModel?.trim()) {
      setError("Set your Ollama model in the top bar before generating.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/api/generate-tests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          platform,
          model: ollamaModel,
          ollamaUrl: ollamaBaseUrl,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Generate request failed (${res.status}): ${errorText.slice(0, 200)}`);
      }

      const data = await res.json();
      const tests = data?.tests || [];

      if (!Array.isArray(tests)) {
        throw new Error("Model response was not an array");
      }

      onGenerate(tests, platform);
    } catch (e) {
      setError(e?.message || "Failed to generate test cases. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          background: "#111827",
          border: "1px solid #1f2937",
          borderRadius: 16,
          width: "100%",
          maxWidth: 540,
          padding: 28,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 24,
          }}
        >
          <h2 style={{ color: "#f9fafb", fontSize: 18, fontWeight: 700, margin: 0 }}>
            ✨ AI Generate Test Cases
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#6b7280",
              cursor: "pointer",
              fontSize: 20,
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label
            style={{
              display: "block",
              color: "#9ca3af",
              fontSize: 12,
              fontWeight: 600,
              marginBottom: 6,
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            Platform
          </label>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            style={{
              width: "100%",
              background: "#1f2937",
              border: "1px solid #374151",
              borderRadius: 8,
              padding: "10px 12px",
              color: "#f9fafb",
              fontSize: 13,
            }}
          >
            {PLATFORMS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </div>
        <div style={{ marginBottom: 20 }}>
          <label
            style={{
              display: "block",
              color: "#9ca3af",
              fontSize: 12,
              fontWeight: 600,
              marginBottom: 6,
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            Describe your app / feature
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            placeholder="e.g. A music streaming app with login, song playback, playlist management, search and social sharing features..."
            style={{
              width: "100%",
              background: "#1f2937",
              border: "1px solid #374151",
              borderRadius: 8,
              padding: "10px 12px",
              color: "#f9fafb",
              fontSize: 13,
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />
        </div>
        {error && <p style={{ color: "#ef4444", fontSize: 13, marginBottom: 12 }}>{error}</p>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "1px solid #374151",
              background: "none",
              color: "#9ca3af",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            onClick={generate}
            disabled={loading || !prompt.trim()}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "none",
              background: loading ? "#374151" : "#6366f1",
              color: "white",
              cursor: loading ? "not-allowed" : "pointer",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {loading ? "⟳ Generating..." : "✨ Generate"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [tests, setTests] = useState(SAMPLE_TESTS);
  const [bugs, setBugs] = useState([]);
  const [activeTab, setActiveTab] = useState("tests");
  const [selectedTest, setSelectedTest] = useState(null);
  const [bugFormTest, setBugFormTest] = useState(null);
  const [showAIModal, setShowAIModal] = useState(false);
  const [filterCat, setFilterCat] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");
  const [platform, setPlatform] = useState("iOS Simulator");
  const [appId, setAppId] = useState("com.yourapp.bundle");
  const [apiBaseUrl, setApiBaseUrl] = useState("http://127.0.0.1:8787");
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState("http://127.0.0.1:11434");
  const [ollamaModel, setOllamaModel] = useState("qwen2.5:3b");
  const [infraStatus, setInfraStatus] = useState("");
  const [runningAll, setRunningAll] = useState(false);
  const nextId = useRef(SAMPLE_TESTS.length + 1);

  const categories = useMemo(
    () => ["All", ...new Set(tests.map((t) => t.category))],
    [tests]
  );

  const simulateRunTest = async (id) => {
    const target = tests.find((t) => t.id === id);
    if (!target || target.status === STATUS.running) return false;

    setTests((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              status: STATUS.running,
              logs: [
                "🚀 Connecting to Appium MCP server...",
                `📱 Targeting: ${platform}`,
                `📦 App ID: ${appId}`,
              ],
            }
          : t
      )
    );
    let passed = false;
    let duration = 0;
    let finalLogs = [];
    let finalLog = "❌ Unknown runner error";

    try {
      const res = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/api/run-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          test: target,
          platform,
          appId,
        }),
      });
      const data = await res.json();
      passed = Boolean(data?.passed);
      duration = Number(data?.duration || 0);
      finalLogs = Array.isArray(data?.logs) ? data.logs : [];
      finalLog = passed ? "✅ All assertions passed" : "❌ Test failed";
      if (!res.ok && data?.error) {
        finalLog = `❌ ${data.error}`;
      }
    } catch (e) {
      finalLog = `❌ ${e?.message || "Failed to reach backend API"}`;
    }

    setTests((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              status: passed ? STATUS.passed : STATUS.failed,
              logs: [...t.logs, ...finalLogs, finalLog, `⏱ Duration: ${duration}s`],
              duration,
            }
          : t
      )
    );

    return passed;
  };

  const runAll = async () => {
    setRunningAll(true);
    const filtered = tests.filter((t) => filterCat === "All" || t.category === filterCat);
    for (const t of filtered) {
      // eslint-disable-next-line no-await-in-loop
      await simulateRunTest(t.id);
    }
    setRunningAll(false);
  };

  const checkInfra = async () => {
    try {
      const res = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/api/health`);
      const data = await res.json();
      setInfraStatus(
        `API:${data.api} | Ollama:${data.ollama} | AppiumMCP:${data.appiumMcp}`
      );
    } catch (e) {
      setInfraStatus(`Health check failed: ${e?.message || "unknown error"}`);
    }
  };

  const resetAll = () =>
    setTests((prev) =>
      prev.map((t) => ({ ...t, status: STATUS.idle, logs: [], duration: null }))
    );

  const addBug = (testId, form) => {
    const test = tests.find((t) => t.id === testId);
    if (!test) return;

    setBugs((prev) => [
      ...prev,
      {
        id: Date.now(),
        testId,
        testName: test.name,
        ...form,
        createdAt: new Date().toLocaleString(),
        status: "Open",
      },
    ]);
    setBugFormTest(null);
    setActiveTab("bugs");
  };

  const closeBug = (id) =>
    setBugs((prev) => prev.map((b) => (b.id === id ? { ...b, status: "Closed" } : b)));

  const handleAIGenerate = (newTests, plt) => {
    const formatted = newTests
      .filter((t) => t?.name && t?.category && Array.isArray(t?.steps) && t?.expected)
      .map((t) => ({
        id: nextId.current++,
        name: t.name,
        category: t.category,
        steps: t.steps,
        expected: t.expected,
        status: STATUS.idle,
        logs: [],
        duration: null,
      }));

    if (formatted.length === 0) return;
    setTests((prev) => [...prev, ...formatted]);
    setPlatform(plt);
    setShowAIModal(false);
  };

  const filteredTests = tests.filter(
    (t) =>
      (filterCat === "All" || t.category === filterCat) &&
      (filterStatus === "All" || t.status === filterStatus)
  );

  const stats = {
    total: tests.length,
    passed: tests.filter((t) => t.status === STATUS.passed).length,
    failed: tests.filter((t) => t.status === STATUS.failed).length,
    running: tests.filter((t) => t.status === STATUS.running).length,
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0f1a",
        fontFamily: "'SF Pro Display', -apple-system, sans-serif",
        color: "#f9fafb",
      }}
    >
      <div
        style={{
          borderBottom: "1px solid #1f2937",
          padding: "16px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#0d1117",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
            }}
          >
            🧪
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: -0.5 }}>AppTest Suite</div>
            <div style={{ fontSize: 11, color: "#6b7280" }}>Powered by Appium MCP · {platform}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            style={{
              background: "#1f2937",
              border: "1px solid #374151",
              borderRadius: 8,
              padding: "6px 10px",
              color: "#f9fafb",
              fontSize: 12,
            }}
          >
            {PLATFORMS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <input
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            placeholder="Bundle/App ID"
            style={{
              background: "#1f2937",
              border: "1px solid #374151",
              borderRadius: 8,
              padding: "6px 10px",
              color: "#f9fafb",
              fontSize: 12,
              width: 180,
            }}
          />
          <input
            value={apiBaseUrl}
            onChange={(e) => setApiBaseUrl(e.target.value)}
            placeholder="Backend API URL"
            style={{
              background: "#1f2937",
              border: "1px solid #374151",
              borderRadius: 8,
              padding: "6px 10px",
              color: "#f9fafb",
              fontSize: 12,
              width: 180,
            }}
          />
          <input
            value={ollamaBaseUrl}
            onChange={(e) => setOllamaBaseUrl(e.target.value)}
            placeholder="Ollama URL"
            style={{
              background: "#1f2937",
              border: "1px solid #374151",
              borderRadius: 8,
              padding: "6px 10px",
              color: "#f9fafb",
              fontSize: 12,
              width: 180,
            }}
          />
          <input
            value={ollamaModel}
            onChange={(e) => setOllamaModel(e.target.value)}
            placeholder="Ollama model"
            style={{
              background: "#1f2937",
              border: "1px solid #374151",
              borderRadius: 8,
              padding: "6px 10px",
              color: "#f9fafb",
              fontSize: 12,
              width: 140,
            }}
          />
          <button
            onClick={checkInfra}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid #374151",
              background: "none",
              color: "#9ca3af",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Check Infra
          </button>
          <a
            href={APPIUM_MCP_URL}
            target="_blank"
            rel="noreferrer"
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid #374151",
              color: "#9ca3af",
              fontSize: 12,
              textDecoration: "none",
            }}
          >
            📦 appium-mcp
          </a>
        </div>
      </div>
      {infraStatus && (
        <div style={{ padding: "8px 24px", fontSize: 12, color: "#9ca3af", borderBottom: "1px solid #1f2937" }}>
          {infraStatus}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 1,
          borderBottom: "1px solid #1f2937",
          background: "#1f2937",
        }}
      >
        {[
          { label: "Total Tests", value: stats.total, color: "#6366f1" },
          { label: "Passed", value: stats.passed, color: "#10b981" },
          { label: "Failed", value: stats.failed, color: "#ef4444" },
          { label: "Bug Reports", value: bugs.length, color: "#f59e0b" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: "#0d1117", padding: "14px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 26, fontWeight: 800, color }}>{value}</div>
            <div
              style={{
                fontSize: 11,
                color: "#6b7280",
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              {label}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          gap: 0,
          borderBottom: "1px solid #1f2937",
          padding: "0 24px",
          background: "#0d1117",
        }}
      >
        {[
          ["tests", "🧪 Test Cases"],
          ["bugs", `🐛 Bug Log (${bugs.length})`],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            style={{
              padding: "12px 20px",
              background: "none",
              border: "none",
              color: activeTab === key ? "#6366f1" : "#6b7280",
              fontWeight: activeTab === key ? 700 : 400,
              fontSize: 14,
              cursor: "pointer",
              borderBottom: activeTab === key ? "2px solid #6366f1" : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", height: "calc(100vh - 200px)" }}>
        {activeTab === "tests" && (
          <>
            <div
              style={{
                width: 380,
                borderRight: "1px solid #1f2937",
                overflowY: "auto",
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  padding: "12px 16px",
                  borderBottom: "1px solid #1f2937",
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <button
                  onClick={() => setShowAIModal(true)}
                  style={{
                    padding: "7px 14px",
                    borderRadius: 8,
                    border: "none",
                    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                    color: "white",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  ✨ AI Generate
                </button>
                <button
                  onClick={runAll}
                  disabled={runningAll}
                  style={{
                    padding: "7px 14px",
                    borderRadius: 8,
                    border: "none",
                    background: runningAll ? "#374151" : "#10b981",
                    color: "white",
                    cursor: runningAll ? "not-allowed" : "pointer",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {runningAll ? "⟳ Running..." : "▶ Run All"}
                </button>
                <button
                  onClick={resetAll}
                  style={{
                    padding: "7px 14px",
                    borderRadius: 8,
                    border: "1px solid #374151",
                    background: "none",
                    color: "#9ca3af",
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  ↺ Reset
                </button>
              </div>
              <div
                style={{
                  padding: "8px 16px",
                  borderBottom: "1px solid #1f2937",
                  display: "flex",
                  gap: 6,
                  flexWrap: "wrap",
                }}
              >
                {categories.map((c) => (
                  <button
                    key={c}
                    onClick={() => setFilterCat(c)}
                    style={{
                      padding: "3px 10px",
                      borderRadius: 999,
                      border: `1px solid ${filterCat === c ? "#6366f1" : "#374151"}`,
                      background: filterCat === c ? "#6366f122" : "none",
                      color: filterCat === c ? "#6366f1" : "#6b7280",
                      cursor: "pointer",
                      fontSize: 11,
                    }}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <div
                style={{
                  padding: "8px 16px",
                  borderBottom: "1px solid #1f2937",
                  display: "flex",
                  gap: 6,
                  flexWrap: "wrap",
                }}
              >
                {["All", ...Object.keys(STATUS)].map((s) => (
                  <button
                    key={s}
                    onClick={() => setFilterStatus(s)}
                    style={{
                      padding: "3px 10px",
                      borderRadius: 999,
                      border: `1px solid ${filterStatus === s ? statusColors[s] || "#6366f1" : "#374151"}`,
                      background:
                        filterStatus === s ? `${statusColors[s] || "#6366f1"}22` : "none",
                      color: filterStatus === s ? statusColors[s] || "#6366f1" : "#6b7280",
                      cursor: "pointer",
                      fontSize: 11,
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>

              {filteredTests.map((test) => (
                <div
                  key={test.id}
                  onClick={() => setSelectedTest(test.id)}
                  style={{
                    padding: "14px 16px",
                    borderBottom: "1px solid #111827",
                    cursor: "pointer",
                    background: selectedTest === test.id ? "#1f2937" : "transparent",
                    transition: "background 0.15s",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      marginBottom: 6,
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: 13,
                        color: "#f9fafb",
                        flex: 1,
                        paddingRight: 8,
                      }}
                    >
                      {test.name}
                    </div>
                    <Badge status={test.status} />
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span
                      style={{
                        fontSize: 11,
                        color: "#6b7280",
                        background: "#1f2937",
                        padding: "2px 8px",
                        borderRadius: 999,
                      }}
                    >
                      {test.category}
                    </span>
                    <span style={{ fontSize: 11, color: "#4b5563" }}>{test.steps.length} steps</span>
                    {test.duration && (
                      <span style={{ fontSize: 11, color: "#4b5563" }}>⏱ {test.duration}s</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
              {selectedTest ? (
                (() => {
                  const test = tests.find((t) => t.id === selectedTest);
                  if (!test) return null;

                  return (
                    <div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          marginBottom: 20,
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontSize: 11,
                              color: "#6b7280",
                              marginBottom: 4,
                              textTransform: "uppercase",
                              letterSpacing: 0.5,
                            }}
                          >
                            {test.category}
                          </div>
                          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{test.name}</h2>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            onClick={() => simulateRunTest(test.id)}
                            disabled={test.status === STATUS.running}
                            style={{
                              padding: "8px 16px",
                              borderRadius: 8,
                              border: "none",
                              background: test.status === STATUS.running ? "#374151" : "#10b981",
                              color: "white",
                              cursor: "pointer",
                              fontSize: 13,
                              fontWeight: 700,
                            }}
                          >
                            {test.status === STATUS.running ? "⟳ Running..." : "▶ Run Test"}
                          </button>
                          {test.status === STATUS.failed && (
                            <button
                              onClick={() => setBugFormTest(test)}
                              style={{
                                padding: "8px 16px",
                                borderRadius: 8,
                                border: "none",
                                background: "#ef4444",
                                color: "white",
                                cursor: "pointer",
                                fontSize: 13,
                                fontWeight: 700,
                              }}
                            >
                              🐛 Log Bug
                            </button>
                          )}
                        </div>
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: 16,
                          marginBottom: 20,
                        }}
                      >
                        <div
                          style={{
                            background: "#111827",
                            borderRadius: 12,
                            padding: 16,
                            border: "1px solid #1f2937",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 11,
                              color: "#6b7280",
                              marginBottom: 10,
                              textTransform: "uppercase",
                              letterSpacing: 0.5,
                            }}
                          >
                            Test Steps
                          </div>
                          {test.steps.map((step, i) => (
                            <div
                              key={i}
                              style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "flex-start" }}
                            >
                              <span
                                style={{
                                  width: 20,
                                  height: 20,
                                  borderRadius: "50%",
                                  background: "#1f2937",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: 10,
                                  color: "#6366f1",
                                  flexShrink: 0,
                                  fontWeight: 700,
                                }}
                              >
                                {i + 1}
                              </span>
                              <span style={{ fontSize: 13, color: "#d1d5db", lineHeight: 1.5 }}>{step}</span>
                            </div>
                          ))}
                        </div>
                        <div
                          style={{
                            background: "#111827",
                            borderRadius: 12,
                            padding: 16,
                            border: "1px solid #1f2937",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 11,
                              color: "#6b7280",
                              marginBottom: 10,
                              textTransform: "uppercase",
                              letterSpacing: 0.5,
                            }}
                          >
                            Expected Result
                          </div>
                          <p style={{ fontSize: 13, color: "#d1d5db", lineHeight: 1.6, margin: 0 }}>
                            {test.expected}
                          </p>
                          <div style={{ marginTop: 16 }}>
                            <div
                              style={{
                                fontSize: 11,
                                color: "#6b7280",
                                marginBottom: 6,
                                textTransform: "uppercase",
                                letterSpacing: 0.5,
                              }}
                            >
                              Status
                            </div>
                            <Badge status={test.status} />
                            {test.duration && (
                              <span style={{ marginLeft: 10, fontSize: 12, color: "#6b7280" }}>
                                ⏱ {test.duration}s
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {test.logs.length > 0 && (
                        <div
                          style={{
                            background: "#050a12",
                            borderRadius: 12,
                            padding: 16,
                            border: "1px solid #1f2937",
                            fontFamily: "monospace",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 11,
                              color: "#6b7280",
                              marginBottom: 10,
                              textTransform: "uppercase",
                              letterSpacing: 0.5,
                            }}
                          >
                            Execution Log
                          </div>
                          {test.logs.map((log, i) => (
                            <div
                              key={i}
                              style={{
                                fontSize: 12,
                                color: log.includes("❌")
                                  ? "#ef4444"
                                  : log.includes("✅")
                                    ? "#10b981"
                                    : "#9ca3af",
                                marginBottom: 4,
                                lineHeight: 1.6,
                              }}
                            >
                              {log}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100%",
                    color: "#4b5563",
                  }}
                >
                  <div style={{ fontSize: 48, marginBottom: 12 }}>🧪</div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>Select a test to view details</div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>or click "Run All" to execute all tests</div>
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === "bugs" && (
          <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>🐛 Bug Log</h2>
              <span style={{ fontSize: 13, color: "#6b7280" }}>
                {bugs.filter((b) => b.status === "Open").length} open ·{" "}
                {bugs.filter((b) => b.status === "Closed").length} closed
              </span>
            </div>
            {bugs.length === 0 ? (
              <div style={{ textAlign: "center", color: "#4b5563", paddingTop: 60 }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>No bugs logged yet</div>
                <div style={{ fontSize: 13, marginTop: 4 }}>Run tests and log bugs from failed test cases</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {bugs.map((bug) => (
                  <div
                    key={bug.id}
                    style={{
                      background: "#111827",
                      border: `1px solid ${bug.status === "Closed" ? "#1f2937" : "#ef444433"}`,
                      borderRadius: 12,
                      padding: 18,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        marginBottom: 10,
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: 15,
                            color: bug.status === "Closed" ? "#6b7280" : "#f9fafb",
                            marginBottom: 4,
                          }}
                        >
                          {bug.title}
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {[
                            {
                              label: bug.severity,
                              color:
                                bug.severity === "Critical"
                                  ? "#ef4444"
                                  : bug.severity === "High"
                                    ? "#f97316"
                                    : "#f59e0b",
                            },
                            { label: bug.priority, color: "#6366f1" },
                            { label: bug.platform, color: "#06b6d4" },
                            { label: bug.status, color: bug.status === "Open" ? "#ef4444" : "#10b981" },
                          ].map(({ label, color }) => (
                            <span
                              key={`${bug.id}-${label}`}
                              style={{
                                fontSize: 11,
                                padding: "2px 8px",
                                borderRadius: 999,
                                background: `${color}22`,
                                color,
                                border: `1px solid ${color}44`,
                              }}
                            >
                              {label}
                            </span>
                          ))}
                        </div>
                      </div>
                      {bug.status === "Open" && (
                        <button
                          onClick={() => closeBug(bug.id)}
                          style={{
                            padding: "6px 12px",
                            borderRadius: 8,
                            border: "1px solid #374151",
                            background: "none",
                            color: "#9ca3af",
                            cursor: "pointer",
                            fontSize: 12,
                          }}
                        >
                          ✓ Close
                        </button>
                      )}
                    </div>
                    <pre
                      style={{
                        fontSize: 12,
                        color: "#9ca3af",
                        background: "#050a12",
                        padding: 12,
                        borderRadius: 8,
                        overflow: "auto",
                        whiteSpace: "pre-wrap",
                        margin: "10px 0 0",
                        fontFamily: "monospace",
                        lineHeight: 1.6,
                      }}
                    >
                      {bug.description}
                    </pre>
                    <div style={{ marginTop: 10, display: "flex", gap: 16, fontSize: 11, color: "#4b5563" }}>
                      <span>📅 {bug.createdAt}</span>
                      {bug.assignee && <span>👤 {bug.assignee}</span>}
                      {bug.tags && <span>🏷 {bug.tags}</span>}
                      <span>🔗 Test: {bug.testName}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {bugFormTest && (
        <BugForm
          test={bugFormTest}
          onSave={(form) => addBug(bugFormTest.id, form)}
          onClose={() => setBugFormTest(null)}
        />
      )}
      {showAIModal && (
        <AIGenerateModal
          onGenerate={handleAIGenerate}
          onClose={() => setShowAIModal(false)}
          ollamaBaseUrl={ollamaBaseUrl}
          ollamaModel={ollamaModel}
          apiBaseUrl={apiBaseUrl}
        />
      )}
    </div>
  );
}
