import React from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import VoicemeeterRemote from "./VoicemeeterRemote";
import ConnectionHub from "./ConnectionHub";
import "./main.css";

const theme = createTheme({
  palette: { mode: "dark", background: { default: "#101014", paper: "#1b1b22" } },
});

const view = new URLSearchParams(window.location.search).get("view");

ReactDOM.createRoot(document.getElementById("root")).render(
  <ThemeProvider theme={theme}>
    <CssBaseline />
    {view === "hub" ? <ConnectionHub /> : <VoicemeeterRemote />}
  </ThemeProvider>,
);

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
