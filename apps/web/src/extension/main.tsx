import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { SidePanel } from "./SidePanel";
import { startupStorageCleanup } from "../cloud/firebaseModels";

// As on the site: whatever the Firebase SDK stored earlier is deleted before it loads, unless a
// remembered project needs it.
void startupStorageCleanup();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SidePanel />
  </StrictMode>,
);
