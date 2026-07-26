(() => {
  "use strict";

  const PANEL_ID = "ocrSuggestionButtons";
  const LABEL_ID = "ocrPossibleMatchesLabel";

  const applyCompactLayout = panel => {
    if (!panel) return;

    panel.style.display = panel.hidden ? "none" : "flex";
    panel.style.gridTemplateColumns = "";
    panel.style.gap = "6px";
    panel.style.margin = "4px 0 0";
    panel.style.padding = "0 0 2px";
    panel.style.overflowX = "auto";
    panel.style.overflowY = "hidden";
    panel.style.webkitOverflowScrolling = "touch";
    panel.style.scrollbarWidth = "thin";
    panel.style.maxWidth = "100%";

    let label = document.getElementById(LABEL_ID);
    if (!label) {
      label = document.createElement("div");
      label.id = LABEL_ID;
      label.textContent = "Possible matches";
      label.style.fontSize = "0.76rem";
      label.style.fontWeight = "700";
      label.style.lineHeight = "1.1";
      label.style.marginTop = "5px";
      label.style.opacity = "0.78";
      panel.parentNode.insertBefore(label, panel);
    }

    label.hidden = panel.hidden || panel.children.length === 0;

    [...panel.querySelectorAll("button")].forEach((button, index) => {
      const original = button.textContent.replace(/^BEST:\s*|^OPTION:\s*/i, "").trim();
      const reason = button.title && !/^Best scanner match:|^Possible scanner match:/i.test(button.title)
        ? button.title
        : "";
      button.textContent = index === 0 ? `Best: ${original}` : original;
      const baseTitle = index === 0
        ? `Best scanner match: ${original}`
        : `Possible scanner match: ${original}`;
      button.title = reason ? `${baseTitle}. ${reason}` : baseTitle;
      button.style.flex = "0 0 auto";
      button.style.width = "auto";
      button.style.minWidth = index === 0 ? "104px" : "82px";
      button.style.maxWidth = "145px";
      button.style.minHeight = "34px";
      button.style.height = "34px";
      button.style.padding = "5px 9px";
      button.style.margin = "0";
      button.style.fontSize = "0.82rem";
      button.style.lineHeight = "1";
      button.style.whiteSpace = "nowrap";
      button.style.overflow = "hidden";
      button.style.textOverflow = "ellipsis";
      button.setAttribute("aria-label", button.title);
    });
  };

  const watchPanel = panel => {
    applyCompactLayout(panel);
    const observer = new MutationObserver(() => applyCompactLayout(panel));
    observer.observe(panel, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "style"]
    });
  };

  const initialize = () => {
    const existing = document.getElementById(PANEL_ID);
    if (existing) {
      watchPanel(existing);
      return;
    }

    const bodyObserver = new MutationObserver(() => {
      const panel = document.getElementById(PANEL_ID);
      if (!panel) return;
      bodyObserver.disconnect();
      watchPanel(panel);
    });

    bodyObserver.observe(document.documentElement, { childList: true, subtree: true });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
