import React from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import VoicemeeterRemote from "./VoicemeeterRemote";
import "./main.css";

const theme = createTheme({
  palette: { mode: "dark", background: { default: "#101014", paper: "#1b1b22" } },
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <ThemeProvider theme={theme}>
    <CssBaseline />
    <VoicemeeterRemote />
  </ThemeProvider>,
);
