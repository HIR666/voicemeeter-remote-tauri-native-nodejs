import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  MenuItem,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import RefreshIcon from "@mui/icons-material/Refresh";
import WifiIcon from "@mui/icons-material/Wifi";
import { QRCodeSVG } from "qrcode.react";

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch { /* WebView clipboard permission can be unavailable */ }
  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

export default function ConnectionHub() {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");
  const [selectedAddress, setSelectedAddress] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/connection-info", { cache: "no-store" });
      if (!response.ok) throw new Error(`Connection details returned HTTP ${response.status}.`);
      const next = await response.json();
      setInfo(next);
      setSelectedAddress((current) => next.interfaces.some((item) => item.address === current)
        ? current
        : (next.interfaces[0]?.address || ""));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  useEffect(() => {
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load]);

  const selectedUrl = useMemo(() => {
    if (!info || !selectedAddress) return "";
    const index = info.interfaces.findIndex((item) => item.address === selectedAddress);
    return info.urls[index] || info.primaryUrl || "";
  }, [info, selectedAddress]);

  const copy = async () => {
    await copyText(selectedUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "#101014", color: "white", p: 3 }}>
      <Stack spacing={2.25} sx={{ maxWidth: 500, mx: "auto" }}>
        <Box>
          <Stack direction="row" alignItems="center" spacing={1.2}>
            <WifiIcon sx={{ color: "#69b7ff" }} />
            <Typography variant="h5" fontWeight={800}>Connection Hub</Typography>
          </Stack>
          <Typography color="text.secondary" sx={{ mt: 0.75 }}>
            Scan once to pair your phone with this PC. Both devices must be on the same network.
          </Typography>
        </Box>

        {error && <Alert severity="error">{error}</Alert>}
        {!info && !error && <Box sx={{ textAlign: "center", py: 8 }}><CircularProgress /></Box>}

        {info && (
          <>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip label={info.computerName} size="small" />
              <Chip label={`Port ${info.port}`} size="small" />
              <Chip
                label={info.connected ? "Voicemeeter connected" : "Waiting for Voicemeeter"}
                color={info.connected ? "success" : "warning"}
                size="small"
              />
            </Stack>

            {info.interfaces.length > 1 && (
              <Select
                size="small"
                value={selectedAddress}
                onChange={(event) => setSelectedAddress(event.target.value)}
                fullWidth
              >
                {info.interfaces.map((item) => (
                  <MenuItem key={`${item.name}-${item.address}`} value={item.address}>
                    {item.name} — {item.address}
                  </MenuItem>
                ))}
              </Select>
            )}

            {selectedUrl ? (
              <Card variant="outlined" sx={{ bgcolor: "#191920", borderColor: "rgba(255,255,255,0.12)" }}>
                <CardContent>
                  <Stack spacing={2} alignItems="center">
                    <Box sx={{ bgcolor: "white", p: 1.5, borderRadius: 2, lineHeight: 0 }}>
                      <QRCodeSVG
                        value={selectedUrl}
                        size={260}
                        level="M"
                        marginSize={1}
                        imageSettings={{ src: "/icons/icon-512.png", width: 42, height: 42, excavate: true }}
                      />
                    </Box>
                    <Typography
                      component="code"
                      sx={{ width: "100%", overflowWrap: "anywhere", color: "#9fd1ff", fontSize: 13 }}
                    >
                      {selectedUrl}
                    </Typography>
                    <Button startIcon={<ContentCopyIcon />} variant="contained" onClick={copy} fullWidth>
                      {copied ? "Copied" : "Copy phone link"}
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            ) : (
              <Alert severity="warning">
                No active LAN IPv4 address was found. Connect this PC to Wi-Fi or Ethernet, then refresh.
              </Alert>
            )}

            <Button startIcon={<RefreshIcon />} variant="outlined" onClick={load}>
              Refresh network details
            </Button>
            <Typography variant="caption" color="text.secondary">
              The port is selected automatically and kept stable. If the PC’s address or port changes, reopen this hub from the tray and scan the updated code.
            </Typography>
          </>
        )}
      </Stack>
    </Box>
  );
}
