"use strict";
// Anti-clickjacking. GitHub Pages can't send a frame-ancestors header, so the page stays hidden
// (see style.css) and is shown only when it is the top-level window, never inside another site's frame.
if (window.top === window.self) {
  document.documentElement.classList.add("top");
} else {
  try { window.top.location = window.self.location.href; } catch (e) { /* cross-origin: stay hidden */ }
}
