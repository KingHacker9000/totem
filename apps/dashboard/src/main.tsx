import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { OperatorConsole } from "./OperatorConsole";
import { ProviderConsole } from "./ProviderConsole";
import "./style.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");

const pathname = window.location.pathname;
const surface =
  pathname === "/providers" ? (
    <ProviderConsole />
  ) : pathname === "/operator" ? (
    <OperatorConsole />
  ) : (
    <App />
  );

createRoot(root).render(<StrictMode>{surface}</StrictMode>);
