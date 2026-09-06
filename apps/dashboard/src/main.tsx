import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ProviderConsole } from "./ProviderConsole";
import "./style.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");

const providerConsole = window.location.pathname === "/providers";

createRoot(root).render(
  <StrictMode>{providerConsole ? <ProviderConsole /> : <App />}</StrictMode>,
);
