import { installConsoleCapture } from "./utils/consoleCapture";
installConsoleCapture(); // first: records console errors for the right-click menu's diagnostics
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// Bundled font (works offline and with the app's strict CSP).
import "@fontsource/quicksand/300.css";
import "@fontsource/quicksand/400.css";
import "@fontsource/quicksand/500.css";
import "@fontsource/quicksand/600.css";
import "@fontsource/quicksand/700.css";
import "./styles/App.css";
import './locales/i18n'; // initializes i18next (side-effect import)

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);