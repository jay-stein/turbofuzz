import "./styles.css";
import { App } from "./ui/app.js";

const root = document.getElementById("app");
if (root === null) throw new Error("Missing #app element");
new App(root);
