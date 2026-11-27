/** Small SVG icons the app shell draws on its own buttons. */

import { svgIcon } from "./dom.js";

export function uploadIcon(): SVGElement {
  return svgIcon(
    '<path d="M12 15V4"/><path d="m7 9 5-5 5 5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    "dropzone-icon",
  );
}

export function lockIcon(): SVGElement {
  return svgIcon(
    '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    "privacy-icon",
  );
}

/** Dice icon for the shuffle control: a die with pips. */
export function diceIcon(): SVGElement {
  return svgIcon(
    '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/>' +
      '<circle cx="8.4" cy="8.4" r="1.25" fill="currentColor" stroke="none"/>' +
      '<circle cx="15.6" cy="15.6" r="1.25" fill="currentColor" stroke="none"/>' +
      '<circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none"/>',
    "shuffle-icon",
  );
}

/** 2×2 grid icon for the column-tiles toggle. */
export function tilesIcon(): SVGElement {
  return svgIcon(
    '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/>' +
      '<rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/>' +
      '<rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/>' +
      '<rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
    "tiles-icon",
  );
}

/** Check mark shown in place of the grid while the tiles strip is on. */
export function checkIcon(): SVGElement {
  return svgIcon('<path d="m5 12.5 4.5 4.5L19 7"/>', "tiles-check");
}

/** Mini bar chart shown while hovering the Info Tiles toggle. */
export function tilesChartIcon(): SVGElement {
  return svgIcon(
    '<path d="M4 19.5h16"/>' +
      '<rect x="5" y="11" width="3.4" height="8.5" rx="1"/>' +
      '<rect x="10.3" y="6.5" width="3.4" height="13" rx="1"/>' +
      '<rect x="15.6" y="13.5" width="3.4" height="6" rx="1"/>',
    "tiles-chart",
  );
}
