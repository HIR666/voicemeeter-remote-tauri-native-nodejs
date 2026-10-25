/* Checks the running installed release, including real LAN token enforcement.
 * It never starts a backend or sends commands that change audio settings. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}
const installDir = option("--install-dir", path.join(process.env.LOCALAPPDATA, "Voicemeeter Remote"));
const dataDir = option("--data-dir", path.join(process.env.APPDATA, "com.rat.voicemeeter-remote"));
const host = option("--host", "127.0.0.1");
const WebSocket = require(path.join(installDir, "server", "node_modules", "ws"));
const config = JSON.parse(fs.readFileSync(path.join(dataDir, "settings.json"), "utf8"));

function get(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    request.setTimeout(5000, () => request.destroy(new Error(`HTTP timeout: ${url.pathname}`)));
    request.on("error", reject);
  });
}

function state(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { origin: `http://${url.host}` });
    const timer = setTimeout(() => finish(new Error("Timed out waiting for hydrated WebSocket state.")), 5000);
    function finish(error, value) {
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.on("error", () => {});
      socket.terminate();
      if (error) reject(error); else resolve(value);
    }
    socket.on("message", (raw) => {
      try {
        const message = JSON.parse(raw);
        if (message.type === "state") finish(null, message.payload);
      } catch (error) { finish(error); }
    });
    socket.on("error", (error) => finish(error));
    socket.on("close", () => finish(new Error("WebSocket closed before hydration.")));
  });
}

async function main() {
  for (const file of ["voicemeeter-remote.exe", "vmr-node.exe", "server/server.js", "ui/dist/index.html"]) {
    assert.ok(fs.statSync(path.join(installDir, file)).isFile(), `Missing installed resource: ${file}`);
  }
  const base = new URL(`http://${host}:${config.port}`);
  const health = await get(new URL("/api/health", base));
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.body).connected, true, "Voicemeeter DLL connection is not ready.");
  const page = await get(new URL("/", base));
  assert.equal(page.status, 200);
  const asset = page.body.match(/src="([^"]+\.js)"/);
  assert.ok(asset, "Installed page has no JavaScript asset.");
  const javascript = await get(new URL(asset[1], base));
  assert.equal(javascript.status, 200);
  assert.ok(!javascript.body.trimStart().startsWith("<!"), "JavaScript URL returned an HTML fallback.");
  console.log("PASS installed resource paths, HTTP page/assets, and Voicemeeter DLL connection");

  const socketUrl = new URL(`/ws?token=${encodeURIComponent(config.authToken)}`, base);
  socketUrl.protocol = "ws:";
  const snapshot = await state(socketUrl);
  assert.equal(snapshot.hydrated, true);
  assert.equal(snapshot.strips.length, 8);
  assert.equal(snapshot.buses.length, 8);
  console.log("PASS authenticated WebSocket with hydrated strip/bus state");

  if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) {
    const unauthenticated = new URL(socketUrl);
    unauthenticated.search = "";
    await assert.rejects(state(unauthenticated), /socket hang up|closed before hydration|Unexpected server response/);
    console.log("PASS LAN WebSocket rejects requests without the pairing token");
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
