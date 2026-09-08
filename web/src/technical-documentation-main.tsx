import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TechnicalDocumentationPage } from "./pages/TechnicalDocumentationPage";
import "./styles/app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TechnicalDocumentationPage />
  </StrictMode>,
);
