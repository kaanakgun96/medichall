import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "../../../medichall-navigation.js";
import "../../../medichall-traffic.js";
import "../../../external-prospects.js";
import "../../../external-prospects.css";
import "./app/styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("React root element was not found.");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
