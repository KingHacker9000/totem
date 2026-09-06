import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ContributionConsole } from "./ContributionConsole";
import { ManagementConsole } from "./ManagementConsole";
import { OperatorConsole } from "./OperatorConsole";
import { ProviderConsole } from "./ProviderConsole";
import { SpeechConsole } from "./SpeechConsole";
import "./style.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");

const pathname = window.location.pathname;
const surface =
  pathname === "/providers" ? (
    <ProviderConsole />
  ) : pathname === "/operator" ? (
    <ManagementConsole />
  ) : pathname === "/operator-classic" ? (
    <OperatorConsole />
  ) : pathname === "/contributions" ? (
    <ContributionConsole />
  ) : pathname === "/speech" ? (
    <SpeechConsole />
  ) : (
    <App />
  );

createRoot(root).render(<StrictMode>{surface}</StrictMode>);
