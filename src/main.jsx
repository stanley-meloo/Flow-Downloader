import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/App.css";
import './locales/i18n'; // Tradução

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);