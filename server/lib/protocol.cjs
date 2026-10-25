const ROUTES = ["A1", "A2", "A3", "A4", "A5", "B1", "B2", "B3"];
const STRIP_PARAMS = ["Gain", "Mute", ...ROUTES];
const BUS_PARAMS = ["Gain", "Mute"];

function finiteNumber(value, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function boolean01(value) {
  return finiteNumber(value) > 0.5 ? 1 : 0;
}

function validIndex(value, maximum) {
  return Number.isInteger(value) && value >= 0 && value < maximum;
}

function validCommand(message) {
  if (!message || typeof message !== "object") return false;
  if (["hydrate", "getState", "restartAudioEngine"].includes(message.type)) return true;

  const payload = message.payload || {};
  if (message.type === "setStripParam") {
    return validIndex(payload.stripIndex, 8) && STRIP_PARAMS.includes(payload.param)
      && Number.isFinite(Number(payload.value));
  }
  if (message.type === "setBusParam") {
    return validIndex(payload.busIndex, 8) && BUS_PARAMS.includes(payload.param)
      && Number.isFinite(Number(payload.value));
  }
  return false;
}

module.exports = { ROUTES, STRIP_PARAMS, BUS_PARAMS, finiteNumber, boolean01, validCommand };
