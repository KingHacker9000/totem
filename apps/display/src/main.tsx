import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ContributionDisplay } from "./ContributionDisplay";
import "./style.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");

const surface =
  window.location.pathname === "/contributions" ? (
    <ContributionDisplay />
  ) : (
    <App />
  );

createRoot(root).render(<StrictMode>{surface}</StrictMode>);
