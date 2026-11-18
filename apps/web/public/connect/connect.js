// Turns https://…/connect/#project=…&app=…&key=… into contextlens://connect?… for the app.
// The fragment never reaches the server; nothing here makes a network request.
(function () {
  var status = document.getElementById("status");
  var open = document.getElementById("open");
  var params = new URLSearchParams(window.location.hash.slice(1));
  // Remove the values from the address bar once read.
  if (window.location.hash) history.replaceState(null, "", window.location.pathname);
  var project = (params.get("project") || "").trim();
  var app = (params.get("app") || "").trim();
  var key = (params.get("key") || "").trim();
  var valid = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project) &&
    /^1:\d+:android:[0-9a-f]+$/.test(app) &&
    /^AIza[0-9A-Za-z_-]{35}$/.test(key);
  if (!valid) {
    status.textContent = "This link is incomplete or malformed. Ask for a new QR code.";
    status.className = "error";
    return;
  }
  var target = new URLSearchParams({ project: project, app: app, key: key });
  open.href = "contextlens://connect?" + target.toString();
  open.hidden = false;
  status.textContent = "This link connects ContextLens to the Firebase project " + project +
    ". Tap the button; the app shows the project and connects only when you tap Save and restart.";
})();
