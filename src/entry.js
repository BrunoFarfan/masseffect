import { isMobileDevice } from "./platform.js";

if (isMobileDevice(navigator)) {
  document.getElementById("desktop-only").hidden = false;
} else {
  document.getElementById("simulation").hidden = false;
  await import("./main.js");
}
