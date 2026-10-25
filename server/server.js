/* Standalone backend: preserves the original Voicemeeter Remote DLL protocol. */
const crypto = require("crypto");
const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");
const koffi = require("koffi");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  ROUTES, STRIP_PARAMS, BUS_PARAMS, finiteNumber, boolean01, validCommand,
} = require("./lib/protocol.cjs");

const STRIP_COUNT = 8;
const BUS_COUNT = 8;
const DLL_PATHS = [
  "C:\\Program Files (x86)\\VB\\Voicemeeter\\VoicemeeterRemote64.dll",
  "C:\\Program Files\\VB\\Voicemeeter\\VoicemeeterRemote64.dll",
];

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const configDir = option("--config-dir") || process.env.VMR_CONFIG_DIR || path.join(process.cwd(), ".vmr-data");
const resourceDir = option("--resource-dir") || process.env.VMR_RESOURCE_DIR;
const configPath = path.join(configDir, "settings.json");
const defaultConfig = {
  port: 5164,
  lanAccess: true,
  allowedInterfaces: [],
  authToken: crypto.randomBytes(24).toString("base64url"),
};

function loadConfig() {
  fs.mkdirSync(configDir, { recursive: true });
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(configPath, "utf8")); } catch (error) {
    if (error.code !== "ENOENT") console.warn("[CONFIG] Using defaults:", error.message);
  }
  const config = { ...defaultConfig, ...saved };
  config.port = Number.isInteger(Number(config.port)) && Number(config.port) > 0 && Number(config.port) < 65536 ? Number(config.port) : 5164;
  config.lanAccess = Boolean(config.lanAccess);
  config.authToken = typeof config.authToken === "string" && config.authToken.length >= 24 ? config.authToken : defaultConfig.authToken;
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return config;
}

const config = loadConfig();
const logPath = path.join(configDir, "server.log");
for (const level of ["log", "warn", "error"]) {
  const original = console[level].bind(console);
  console[level] = (...values) => {
    original(...values);
    try {
      fs.appendFileSync(logPath, `${new Date().toISOString()} [${level.toUpperCase()}] ${values.map(String).join(" ")}\n`);
    } catch { /* logging must never affect audio control */ }
  };
}
const uiDir = resourceDir
  ? path.join(resourceDir, "ui", "dist")
  : path.resolve(__dirname, "..", "ui", "dist");
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "8kb" }));

function localAddresses() {
  const values = new Set(["127.0.0.1", "::1", "localhost"]);
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const item of interfaces || []) values.add(item.address);
  }
  return values;
}

function remoteAddress(request) {
  return request.socket.remoteAddress?.replace("::ffff:", "") || "";
}

function isLoopback(request) {
  return ["127.0.0.1", "::1"].includes(remoteAddress(request));
}

function authorized(request, url) {
  return isLoopback(request) || crypto.timingSafeEqual(
    Buffer.from(String(url.searchParams.get("token") || request.headers["x-vmr-token"] || "")),
    Buffer.from(config.authToken),
  );
}

function requireAuth(request, response, next) {
  const url = new URL(request.originalUrl, `http://${request.headers.host || "localhost"}`);
  try {
    if (authorized(request, url)) return next();
  } catch { /* mismatched token length */ }
  response.status(401).json({ error: "Pair this browser with the local access URL first." });
}

function safeHost(request, response, next) {
  const host = String(request.headers.host || "").replace(/^\[|\]$/g, "").split(":")[0];
  if (!host || localAddresses().has(host) || config.allowedInterfaces.includes(host)) return next();
  response.status(421).send("Unknown Host");
}

app.use(safeHost);

let vm = null;
let connected = false;
let reconnectTimer = null;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function stripPath(index, param) { return `Strip[${index}].${param}`; }
function busPath(index, param) { return `Bus[${index}].${param}`; }

function disconnectVm() {
  if (vm?.logout) { try { vm.logout(); } catch {} }
  vm = null;
  connected = false;
}

function connectVm() {
  disconnectVm();
  const dllPath = DLL_PATHS.find((candidate) => fs.existsSync(candidate));
  if (!dllPath) throw new Error("VoicemeeterRemote64.dll was not found in the standard Voicemeeter installation paths.");
  const dll = koffi.load(dllPath);
  const instance = {
    login: dll.func("long __stdcall VBVMR_Login(void)"),
    logout: dll.func("long __stdcall VBVMR_Logout(void)"),
    dirty: dll.func("long __stdcall VBVMR_IsParametersDirty(void)"),
    get: dll.func("long __stdcall VBVMR_GetParameterFloat(const char *name, _Out_ float *value)"),
    set: dll.func("long __stdcall VBVMR_SetParameterFloat(const char *name, float value)"),
  };
  const result = instance.login();
  if (result < 0) throw new Error(`Voicemeeter login failed (${result}).`);
  vm = instance;
  connected = true;
  console.log(`[VM] Connected via ${dllPath}`);
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setInterval(() => {
    if (connected) return;
    try { connectVm(); broadcastState("voicemeeter-reconnected"); }
    catch (error) { console.warn("[VM] Reconnect pending:", error.message); }
  }, 15000);
}

function refresh() { if (vm) { try { vm.dirty(); } catch { connected = false; } } }
function getFloat(parameter) {
  if (!vm) return 0;
  refresh();
  const out = [0];
  const result = vm.get(parameter, out);
  if (result !== 0) console.warn("[VM] Read failed", parameter, result);
  return finiteNumber(out[0]);
}
function setFloat(parameter, value) {
  if (!vm) throw new Error("Voicemeeter is not connected.");
  const result = vm.set(parameter, finiteNumber(value));
  if (result !== 0) throw new Error(`Voicemeeter rejected ${parameter} (${result}).`);
}

function readStrip(index) {
  const strip = { index, gain: getFloat(stripPath(index, "Gain")), mute: boolean01(getFloat(stripPath(index, "Mute"))) };
  for (const route of ROUTES) strip[route] = boolean01(getFloat(stripPath(index, route)));
  return strip;
}
function readBus(index) {
  return { index, name: ROUTES[index] || `Bus ${index + 1}`, gain: getFloat(busPath(index, "Gain")), mute: boolean01(getFloat(busPath(index, "Mute"))) };
}
async function readState() {
  if (connected) await sleep(20);
  return {
    connected,
    hydrated: connected,
    strips: Array.from({ length: STRIP_COUNT }, (_, index) => readStrip(index)),
    buses: Array.from({ length: BUS_COUNT }, (_, index) => readBus(index)),
  };
}

const server = app.listen(config.port, config.lanAccess ? "0.0.0.0" : "127.0.0.1", () => {
  console.log(`[HTTP] Listening on ${config.lanAccess ? "LAN" : "loopback"} port ${config.port}`);
  console.log(`[HTTP] UI directory: ${uiDir}`);
});
server.on("error", (error) => {
  console.error("[HTTP] Server error:", error.message);
  if (error.code === "EADDRINUSE") console.error("[HTTP] The configured port is occupied; no process was terminated.");
  disconnectVm();
  process.exit(1);
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 8192 });

async function sendState(socket, reason = "state") {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "state", reason, payload: await readState() }));
}
async function broadcastState(reason = "state") {
  const payload = JSON.stringify({ type: "state", reason, payload: await readState() });
  for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(payload);
}
async function restartAudioEngine() {
  setFloat("Command.Restart", 1);
  await sleep(1200);
  refresh();
}

wss.on("connection", (socket) => {
  sendState(socket, "initial-hydrated").catch(() => socket.close(1011));
  socket.on("message", async (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      if (!validCommand(message)) throw new Error("Unsupported or invalid control command.");
      if (message.type === "hydrate" || message.type === "getState") return sendState(socket, "manual-hydrate");
      if (message.type === "restartAudioEngine") { await restartAudioEngine(); return broadcastState("after audio engine restart"); }
      const { payload } = message;
      if (message.type === "setStripParam") {
        const value = payload.param === "Gain" ? finiteNumber(payload.value) : boolean01(payload.value);
        setFloat(stripPath(payload.stripIndex, payload.param), value);
      }
      if (message.type === "setBusParam") {
        const value = payload.param === "Gain" ? finiteNumber(payload.value) : boolean01(payload.value);
        setFloat(busPath(payload.busIndex, payload.param), value);
      }
      await sleep(80);
      await broadcastState("after control change");
    } catch (error) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "error", message: error.message }));
    }
  });
});

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (url.pathname !== "/ws") return socket.destroy();
  const suppliedToken = String(url.searchParams.get("token") || request.headers["x-vmr-token"] || "");
  try {
    if (!authorized(request, url)) {
      console.warn(`[WS] Rejected upgrade from ${remoteAddress(request)}: token ${suppliedToken ? `present (${suppliedToken.length} chars) but invalid` : "missing"}; origin=${request.headers.origin || "<none>"}; host=${request.headers.host || "<none>"}`);
      return socket.destroy();
    }
  } catch {
    console.warn(`[WS] Rejected upgrade from ${remoteAddress(request)}: token length mismatch; origin=${request.headers.origin || "<none>"}; host=${request.headers.host || "<none>"}`);
    return socket.destroy();
  }

  const origin = request.headers.origin;
  const expectedOrigins = new Set([
    `http://${request.headers.host}`,
    `https://${request.headers.host}`,
  ]);
  if (!isLoopback(request) && origin && !expectedOrigins.has(origin)) {
    // Some mobile in-app browsers use an opaque or embedding-app Origin even
    // after navigating to a LAN URL. The unguessable pairing token remains the
    // authorization boundary, so a nonstandard Origin is diagnostic, not fatal.
    console.warn(`[WS] Authenticated upgrade from ${remoteAddress(request)} with nonstandard origin=${origin}; host=${request.headers.host || "<none>"}`);
  }
  wss.handleUpgrade(request, socket, head, (websocket) => wss.emit("connection", websocket, request));
});

app.get("/api/health", (request, response) => response.json({ running: true, connected, port: config.port }));
app.get("/api/status", requireAuth, (request, response) => response.json({ running: true, connected, port: config.port, lanAccess: config.lanAccess }));
app.post("/api/restart-audio", requireAuth, async (_request, response) => {
  try { await restartAudioEngine(); await broadcastState("after audio engine restart"); response.status(204).end(); }
  catch (error) { response.status(503).json({ error: error.message }); }
});
if (fs.existsSync(uiDir)) {
  app.use(express.static(uiDir, { index: false, maxAge: "1h" }));
  app.get("*splat", (_request, response) => response.sendFile(path.join(uiDir, "index.html")));
} else {
  app.get("*splat", (_request, response) => response.status(503).send("The UI build is missing. Run npm run build:ui."));
}

try { connectVm(); } catch (error) { console.warn("[VM] Startup deferred:", error.message); scheduleReconnect(); }

function shutdown() {
  console.log("[SERVER] Shutting down.");
  clearInterval(reconnectTimer);
  for (const client of wss.clients) client.close(1001, "Server stopping");
  disconnectVm();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
