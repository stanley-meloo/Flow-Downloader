import { installConsoleCapture } from "./utils/consoleCapture";
installConsoleCapture(); // first: records console errors for the right-click menu's diagnostics
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// Bundled font (works offline and with the app's strict CSP).
import "@fontsource/poppins/300.css";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import "./styles/App.css";
import './locales/i18n'; // initializes i18next (side-effect import)
import { startAutoMarquee } from "./utils/autoMarquee";
import { startMouseNavigation } from "./utils/mouseNavigation";
import { startAccentColor } from "./utils/accentColor";
import { startContrastWatch } from "./utils/contrastWatch";
import { startMouseFocusRelease } from "./utils/a11y";
startMouseFocusRelease(); // mouse-clicked buttons don't keep focus (Enter goes to the app)
startAccentColor(); // accent color (icons, switches) follows the background
startContrastWatch(); // placeholder / gear turn dark on a light background (utils/contrastWatch.js)
startMouseNavigation(); // mouse side buttons: Back / Forward (dialogs, Settings pages)
startAutoMarquee(); // truncated text ("…") scrolls back and forth so it can be read

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);