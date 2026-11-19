import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { prepareBrowserStorage } from "./cloud/firebaseModels";
import { loadProject } from "./cloud/project";

// Without a remembered project, whatever the Firebase SDK stored in an earlier visit (an App
// Check token, before Disconnect reloaded the page) is deleted before the SDK can load.
void prepareBrowserStorage(loadProject() !== null);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
