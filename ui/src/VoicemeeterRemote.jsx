import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Slider,
  Stack,
  Button,
  Chip,
  Grid,
  IconButton,
  Tooltip,
  Collapse,
  Divider,
} from "@mui/material";
import PianoIcon from "@mui/icons-material/Piano";
import MusicNoteIcon from "@mui/icons-material/MusicNote";
import LanguageIcon from "@mui/icons-material/Language";
import MicIcon from "@mui/icons-material/Mic";
import WindowIcon from "@mui/icons-material/Window";
import GraphicEqIcon from "@mui/icons-material/GraphicEq";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import DiscordIcon from "./assets/DiscordIcon";
import SpotifyIcon from "./assets/SpotifyIcon";

// Same-origin in production keeps desktop and LAN clients on one authenticated
// endpoint. Vite can override this for backend-only development.
const wsUrl = () => {
  if (import.meta.env.VITE_VM_REMOTE_WS_URL) {
    return import.meta.env.VITE_VM_REMOTE_WS_URL;
  }

  const token = new URLSearchParams(window.location.search).get("token");
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(`${protocol}//${window.location.host}/ws`);
  if (token) url.searchParams.set("token", token);
  return url.toString();
};
const HOT_COLOR = "#f8634d";

const ROUTES = ["A1", "A2", "A3", "A4", "A5", "B1", "B2", "B3"];

const STRIP_CONFIG = [
  { index: 0, name: "Instrument 1", Icon: PianoIcon },
  { index: 1, name: "Instrument 2", Icon: PianoIcon },
  { index: 2, name: "Chrome", Icon: LanguageIcon },
  { index: 3, name: "Spotify", Icon: SpotifyIcon },
  { index: 4, name: "Microphone", Icon: MicIcon },
  { index: 5, name: "Windows", Icon: WindowIcon },
  { index: 6, name: "Discord", Icon: DiscordIcon },
  { index: 7, name: "Ableton", Icon: GraphicEqIcon },
];

const BUS_CONFIG = [
  { index: 0, name: "A1" },
  { index: 1, name: "A2" },
  { index: 2, name: "A3" },
  { index: 3, name: "A4" },
  { index: 4, name: "A5" },
  { index: 5, name: "B1" },
  { index: 6, name: "B2" },
  { index: 7, name: "B3" },
];

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isOn(value) {
  return toNumber(value) > 0.5;
}

function formatGain(value) {
  const n = toNumber(value);
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}`;
}

export default function VoicemeeterRemote() {
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);

  const [connected, setConnected] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [restartingEngine, setRestartingEngine] = useState(false);
  const [strips, setStrips] = useState([]);
  const [buses, setBuses] = useState([]);
  const [localGains, setLocalGains] = useState({});
  const [localBusGains, setLocalBusGains] = useState({});
  const [mastersOpen, setMastersOpen] = useState(false);

  const stripsByIndex = useMemo(() => {
    const mapped = {};
    strips.forEach((strip) => {
      mapped[strip.index] = strip;
    });
    return mapped;
  }, [strips]);

  const busesByIndex = useMemo(() => {
    const mapped = {};
    buses.forEach((bus) => {
      mapped[bus.index] = bus;
    });
    return mapped;
  }, [buses]);

  useEffect(() => {
    let disposed = false;

    const connect = () => {
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[WS] connected");
        setConnected(true);
        ws.send(JSON.stringify({ type: "hydrate" }));
      };

      ws.onclose = () => {
        console.log("[WS] disconnected");
        setConnected(false);
        setHydrated(false);
        setRestartingEngine(false);
        if (!disposed) reconnectTimerRef.current = window.setTimeout(connect, 2000);
      };

      ws.onerror = (err) => {
        console.error("[WS] error", err);
        setRestartingEngine(false);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

        if (msg.type === "state") {
          console.log("[STATE]", msg.reason, msg.payload);

          if (msg.reason === "after audio engine restart") {
            setRestartingEngine(false);
          }

          const nextStrips = msg.payload?.strips || [];
          const nextBuses = msg.payload?.buses || [];

          setHydrated(Boolean(msg.payload?.hydrated));
          setStrips(nextStrips);
          setBuses(nextBuses);

          const nextGains = {};
          nextStrips.forEach((strip) => {
            nextGains[strip.index] = toNumber(strip.gain);
          });
          setLocalGains(nextGains);

          const nextBusGains = {};
          nextBuses.forEach((bus) => {
            nextBusGains[bus.index] = toNumber(bus.gain);
          });
          setLocalBusGains(nextBusGains);
        }

        if (msg.type === "error") {
          console.error("[SERVER ERROR]", msg.message);
          setRestartingEngine(false);
        }
        } catch (err) {
          console.error("[WS PARSE ERROR]", err);
          setRestartingEngine(false);
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, []);

  const sendMessage = (payload) => {
    const ws = wsRef.current;

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error("[SEND FAILED] websocket not ready");
      return false;
    }

    console.log("[SEND]", payload);
    ws.send(JSON.stringify(payload));
    return true;
  };

  const handleRefresh = () => {
    console.log("[MANUAL REFRESH] hydrate from VoiceMeeter");
    sendMessage({ type: "hydrate" });
  };

  const handleRestartAudioEngine = () => {
    console.log("[RESTART AUDIO ENGINE] requested");

    setRestartingEngine(true);

    const sent = sendMessage({ type: "restartAudioEngine" });

    if (!sent) {
      setRestartingEngine(false);
    }
  };

  const patchLocalStrip = (stripIndex, param, value) => {
    setStrips((current) =>
      current.map((strip) => {
        if (strip.index !== stripIndex) return strip;
        return { ...strip, [param.toLowerCase()]: value, [param]: value };
      }),
    );
  };

  const patchLocalBus = (busIndex, param, value) => {
    setBuses((current) =>
      current.map((bus) => {
        if (bus.index !== busIndex) return bus;
        return { ...bus, [param.toLowerCase()]: value };
      }),
    );
  };

  const handleToggle = (stripIndex, param) => {
    const strip = stripsByIndex[stripIndex];

    if (!strip) {
      console.error("[TOGGLE] strip not found", stripIndex);
      return;
    }

    const currentParsed = isOn(strip[param]);
    const nextValue = currentParsed ? 0 : 1;

    patchLocalStrip(stripIndex, param, nextValue);

    sendMessage({
      type: "setStripParam",
      payload: { stripIndex, param, value: nextValue },
    });
  };

  const handleStripMuteToggle = (stripIndex) => {
    const strip = stripsByIndex[stripIndex];

    if (!strip) {
      console.error("[STRIP MUTE] strip not found", stripIndex);
      return;
    }

    const currentParsed = isOn(strip.mute);
    const nextValue = currentParsed ? 0 : 1;

    console.group(`[STRIP MUTE] Strip ${stripIndex}`);
    console.log("Current raw:", strip.mute);
    console.log("Current parsed:", currentParsed);
    console.log("Next value:", nextValue);
    console.groupEnd();

    patchLocalStrip(stripIndex, "Mute", nextValue);

    sendMessage({
      type: "setStripParam",
      payload: { stripIndex, param: "Mute", value: nextValue },
    });
  };

  const handleBusMuteToggle = (busIndex) => {
    const bus = busesByIndex[busIndex];

    if (!bus) {
      console.error("[BUS MUTE] bus not found", busIndex);
      return;
    }

    const currentParsed = isOn(bus.mute);
    const nextValue = currentParsed ? 0 : 1;

    patchLocalBus(busIndex, "Mute", nextValue);

    sendMessage({
      type: "setBusParam",
      payload: { busIndex, param: "Mute", value: nextValue },
    });
  };

  const handleGainChange = (stripIndex, value) => {
    const safeValue = toNumber(value);
    setLocalGains((current) => ({ ...current, [stripIndex]: safeValue }));
  };

  const handleGainCommitted = (stripIndex, value) => {
    const safeValue = toNumber(value);

    patchLocalStrip(stripIndex, "gain", safeValue);

    sendMessage({
      type: "setStripParam",
      payload: { stripIndex, param: "Gain", value: safeValue },
    });
  };

  const handleResetGain = (stripIndex) => {
    setLocalGains((current) => ({ ...current, [stripIndex]: 0 }));
    patchLocalStrip(stripIndex, "gain", 0);

    sendMessage({
      type: "setStripParam",
      payload: { stripIndex, param: "Gain", value: 0 },
    });
  };

  const handleBusGainChange = (busIndex, value) => {
    const safeValue = toNumber(value);
    setLocalBusGains((current) => ({ ...current, [busIndex]: safeValue }));
  };

  const handleBusGainCommitted = (busIndex, value) => {
    const safeValue = toNumber(value);

    patchLocalBus(busIndex, "Gain", safeValue);

    sendMessage({
      type: "setBusParam",
      payload: { busIndex, param: "Gain", value: safeValue },
    });
  };

  const handleResetBusGain = (busIndex) => {
    setLocalBusGains((current) => ({ ...current, [busIndex]: 0 }));
    patchLocalBus(busIndex, "Gain", 0);

    sendMessage({
      type: "setBusParam",
      payload: { busIndex, param: "Gain", value: 0 },
    });
  };

  return (
    <Box
      sx={{ minHeight: "100vh", bgcolor: "#101014", color: "white", p: 1.25 }}
    >
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        sx={{ mb: 1.5 }}
      >
        <Typography variant="h6" fontWeight={800}>
          VoiceMeeter
        </Typography>

        <Chip
          label={connected ? "Connected" : "Disconnected"}
          color={connected ? "success" : "error"}
          size="small"
        />

        <Chip
          label={hydrated ? "Synced" : "Not synced"}
          color={hydrated ? "primary" : "warning"}
          size="small"
        />
      </Stack>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        sx={{ mb: 1.5 }}
      >
        <Button
          size="small"
          variant="outlined"
          onClick={handleRefresh}
          disabled={!connected || restartingEngine}
          sx={{
            color: "rgba(255,255,255,0.85)",
            borderColor: "rgba(255,255,255,0.25)",
            textTransform: "none",
          }}
        >
          Sync
        </Button>

        <Tooltip title="Restart VoiceMeeter audio engine">
          <span>
            <IconButton
              size="small"
              onClick={handleRestartAudioEngine}
              disabled={!connected || restartingEngine}
              sx={{
                width: 32,
                height: 32,
                borderRadius: 1.25,
                color: restartingEngine ? HOT_COLOR : "rgba(255,255,255,0.85)",
                border: `1px solid ${
                  restartingEngine ? HOT_COLOR : "rgba(255,255,255,0.25)"
                }`,
                bgcolor: restartingEngine
                  ? "rgba(248,99,77,0.12)"
                  : "transparent",
                "&.Mui-disabled": {
                  color: "rgba(255,255,255,0.35)",
                  borderColor: "rgba(255,255,255,0.12)",
                },
              }}
            >
              <RestartAltIcon
                fontSize="small"
                sx={{
                  animation: restartingEngine
                    ? "vmSpin 0.9s linear infinite"
                    : "none",
                  "@keyframes vmSpin": {
                    "0%": { transform: "rotate(0deg)" },
                    "100%": { transform: "rotate(360deg)" },
                  },
                }}
              />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      <Grid container spacing={1}>
        {STRIP_CONFIG.map((config) => {
          const strip = stripsByIndex[config.index] || {};
          const gainValue = toNumber(localGains[config.index] ?? strip.gain);
          const muted = isOn(strip.mute);
          const isHot = gainValue > 0;
          const Icon = config.Icon || MusicNoteIcon;

          return (
            <Grid item xs={12} key={config.index}>
              <Card
                sx={{
                  bgcolor: "#1b1b22",
                  color: "white",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 2,
                  opacity: muted ? 0.82 : 1,
                }}
              >
                <CardContent sx={{ p: 1.25, "&:last-child": { pb: 1.25 } }}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Tooltip
                      title={
                        muted ? `Unmute ${config.name}` : `Mute ${config.name}`
                      }
                    >
                      <IconButton
                        onClick={() => handleStripMuteToggle(config.index)}
                        size="small"
                        sx={{
                          width: 38,
                          height: 38,
                          borderRadius: 1.5,
                          bgcolor: muted
                            ? "rgba(248,99,77,0.16)"
                            : "rgba(255,255,255,0.07)",
                          color: muted
                            ? HOT_COLOR
                            : isHot
                              ? HOT_COLOR
                              : "rgba(255,255,255,0.85)",
                          border: `1px solid ${
                            muted ? HOT_COLOR : "rgba(255,255,255,0.08)"
                          }`,
                          flexShrink: 0,
                        }}
                      >
                        <Icon fontSize="small" />
                      </IconButton>
                    </Tooltip>

                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography
                        variant="caption"
                        sx={{
                          display: "block",
                          opacity: muted ? 0.45 : 0.7,
                          lineHeight: 1,
                          mb: 0.25,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {config.name}
                      </Typography>

                      <Slider
                        value={gainValue}
                        min={-60}
                        max={12}
                        step={0.5}
                        disabled={muted}
                        onChange={(_, value) =>
                          handleGainChange(config.index, value)
                        }
                        onChangeCommitted={(_, value) =>
                          handleGainCommitted(config.index, value)
                        }
                        sx={{
                          p: 0,
                          height: 4,
                          color: isHot ? HOT_COLOR : "success.main",
                          opacity: muted ? 0.35 : 1,
                          "& .MuiSlider-thumb": {
                            width: 16,
                            height: 16,
                            bgcolor: isHot ? HOT_COLOR : "success.main",
                            border: "2px solid rgba(255,255,255,0.8)",
                            boxShadow: "none",
                          },
                          "& .MuiSlider-track": {
                            border: "none",
                          },
                          "& .MuiSlider-rail": {
                            opacity: 0.25,
                          },
                        }}
                      />
                    </Box>

                    <Tooltip title="Reset to 0 dB">
                      <IconButton
                        onClick={() => handleResetGain(config.index)}
                        size="small"
                        disabled={muted}
                        sx={{
                          width: 42,
                          height: 34,
                          borderRadius: 1.5,
                          color: isHot ? HOT_COLOR : "rgba(255,255,255,0.85)",
                          border: `1px solid ${
                            isHot ? HOT_COLOR : "rgba(255,255,255,0.2)"
                          }`,
                          fontSize: 12,
                          fontWeight: 800,
                          flexShrink: 0,
                          opacity: muted ? 0.35 : 1,
                          "&.Mui-disabled": {
                            color: "rgba(255,255,255,0.35)",
                            borderColor: "rgba(255,255,255,0.12)",
                          },
                        }}
                      >
                        {formatGain(gainValue)}
                      </IconButton>
                    </Tooltip>
                  </Stack>

                  <Stack
                    direction="row"
                    spacing={0.5}
                    flexWrap="wrap"
                    useFlexGap
                    sx={{ mt: 1 }}
                  >
                    {ROUTES.map((route) => {
                      const active = isOn(strip[route]);

                      return (
                        <Button
                          key={route}
                          size="small"
                          variant={active ? "contained" : "outlined"}
                          color={active ? "success" : "inherit"}
                          onClick={() => handleToggle(config.index, route)}
                          sx={{
                            minWidth: 34,
                            px: 0.75,
                            py: 0.25,
                            fontSize: 11,
                            lineHeight: 1.4,
                            fontWeight: 800,
                            borderRadius: 1,
                            color: active ? "#fff" : "rgba(255,255,255,0.65)",
                            borderColor: active
                              ? undefined
                              : "rgba(255,255,255,0.18)",
                          }}
                        >
                          {route}
                        </Button>
                      );
                    })}
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      <Card
        sx={{
          mt: 1,
          bgcolor: "#1b1b22",
          color: "white",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 2,
        }}
      >
        <Button
          fullWidth
          onClick={() => setMastersOpen((current) => !current)}
          endIcon={mastersOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          sx={{
            justifyContent: "space-between",
            px: 1.25,
            py: 1,
            color: "white",
            textTransform: "none",
            fontWeight: 800,
          }}
        >
          Master Buses
        </Button>

        <Collapse in={mastersOpen} timeout="auto" unmountOnExit>
          <Divider sx={{ borderColor: "rgba(255,255,255,0.08)" }} />

          <CardContent sx={{ p: 1.25, "&:last-child": { pb: 1.25 } }}>
            <Grid container spacing={1}>
              {BUS_CONFIG.map((config) => {
                const bus = busesByIndex[config.index] || {};
                const gainValue = toNumber(
                  localBusGains[config.index] ?? bus.gain,
                );
                const muted = isOn(bus.mute);
                const isHot = gainValue > 0;

                return (
                  <Grid item xs={12} key={config.index}>
                    <Card
                      sx={{
                        bgcolor: "rgba(255,255,255,0.035)",
                        color: "white",
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: 1.5,
                        opacity: muted ? 0.82 : 1,
                      }}
                    >
                      <CardContent sx={{ p: 1, "&:last-child": { pb: 1 } }}>
                        <Stack direction="row" alignItems="center" spacing={1}>
                          <Tooltip title={muted ? "Unmute" : "Mute"}>
                            <IconButton
                              size="small"
                              onClick={() => handleBusMuteToggle(config.index)}
                              sx={{
                                width: 38,
                                height: 38,
                                borderRadius: 1.5,
                                bgcolor: muted
                                  ? "rgba(248,99,77,0.16)"
                                  : "rgba(255,255,255,0.07)",
                                color: muted
                                  ? HOT_COLOR
                                  : "rgba(255,255,255,0.85)",
                                border: `1px solid ${
                                  muted ? HOT_COLOR : "rgba(255,255,255,0.08)"
                                }`,
                                flexShrink: 0,
                              }}
                            >
                              {muted ? (
                                <VolumeOffIcon fontSize="small" />
                              ) : (
                                <VolumeUpIcon fontSize="small" />
                              )}
                            </IconButton>
                          </Tooltip>

                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography
                              variant="caption"
                              sx={{
                                display: "block",
                                opacity: muted ? 0.45 : 0.7,
                                lineHeight: 1,
                                mb: 0.25,
                                fontWeight: 800,
                              }}
                            >
                              {config.name}
                            </Typography>

                            <Slider
                              value={gainValue}
                              min={-60}
                              max={12}
                              step={0.5}
                              disabled={muted}
                              onChange={(_, value) =>
                                handleBusGainChange(config.index, value)
                              }
                              onChangeCommitted={(_, value) =>
                                handleBusGainCommitted(config.index, value)
                              }
                              sx={{
                                p: 0,
                                height: 4,
                                color: isHot ? HOT_COLOR : "success.main",
                                opacity: muted ? 0.35 : 1,
                                "& .MuiSlider-thumb": {
                                  width: 16,
                                  height: 16,
                                  bgcolor: isHot ? HOT_COLOR : "success.main",
                                  border: "2px solid rgba(255,255,255,0.8)",
                                  boxShadow: "none",
                                },
                                "& .MuiSlider-track": {
                                  border: "none",
                                },
                                "& .MuiSlider-rail": {
                                  opacity: 0.25,
                                },
                              }}
                            />
                          </Box>

                          <Tooltip title="Reset bus to 0 dB">
                            <IconButton
                              onClick={() => handleResetBusGain(config.index)}
                              size="small"
                              disabled={muted}
                              sx={{
                                width: 42,
                                height: 34,
                                borderRadius: 1.5,
                                color: isHot
                                  ? HOT_COLOR
                                  : "rgba(255,255,255,0.85)",
                                border: `1px solid ${
                                  isHot ? HOT_COLOR : "rgba(255,255,255,0.2)"
                                }`,
                                fontSize: 12,
                                fontWeight: 800,
                                flexShrink: 0,
                                opacity: muted ? 0.35 : 1,
                                "&.Mui-disabled": {
                                  color: "rgba(255,255,255,0.35)",
                                  borderColor: "rgba(255,255,255,0.12)",
                                },
                              }}
                            >
                              {formatGain(gainValue)}
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      </CardContent>
                    </Card>
                  </Grid>
                );
              })}
            </Grid>
          </CardContent>
        </Collapse>
      </Card>
    </Box>
  );
}
