import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { startupStorageCleanup } from "./cloud/firebaseModels";

// Unless a remembered project uses App Check, whatever the Firebase SDK stored in an earlier
// visit (an App Check token, before Disconnect reloaded the page) is deleted before it loads.
void startupStorageCleanup();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
