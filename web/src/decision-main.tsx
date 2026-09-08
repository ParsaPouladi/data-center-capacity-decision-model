import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DecisionPage } from "./pages/DecisionPage";
import "./styles/app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DecisionPage />
  </StrictMode>,
);
