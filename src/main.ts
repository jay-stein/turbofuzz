import "./styles.css";
import { App } from "./ui/app.js";
import { applyThemePreference, readThemePreference } from "./ui/theme.js";

const root = document.getElementById("app");
if (root === null) throw new Error("Missing #app element");
applyThemePreference(readThemePreference());
new App(root);
