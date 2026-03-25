(() => {
  try {
    const current = window.__rpaDesktopPickerState;
    if (current && current.installed) {
      current.lastPingAt = Date.now();
      return { status: "already-installed", installedAt: current.installedAt || null };
    }

    const state = {
      installed: true,
      installedAt: Date.now(),
      lastPingAt: Date.now(),
      overlay: null,
      outlineEl: null,
      toolbarRoot: null,
      toolbarStatus: null,
      active: null,
      prevCursor: null,
      mouseMoves: 0,
      interceptedClicks: 0
    };
    window.__rpaDesktopPickerState = state;
    window.__rpaDesktopPickerInstalled = true;

    function safeText(value) {
      if (typeof value !== "string") {
        return "";
      }
      return value.replace(/\\s+/g, " ").trim();
    }

    function q(value) {
      return value.replace(/\\\\/g, "\\\\\\\\").replace(/"/g, "\\\\\"");
    }

    function addCandidate(list, type, value, score) {
      if (!value || typeof value !== "string") {
        return;
      }
      const trimmed = value.trim();
      if (!trimmed) {
        return;
      }
      if (list.some(item => item.type === type && item.value === trimmed)) {
        return;
      }
      list.push({
        type,
        value: trimmed,
        score: Math.max(0, Math.min(1, Number(score) || 0.5)),
        primary: false
      });
    }

    function buildCssPath(el) {
      if (!(el instanceof Element)) {
        return "";
      }
      const parts = [];
      let currentEl = el;
      while (currentEl && currentEl.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
        const tag = currentEl.tagName.toLowerCase();
        if (currentEl.id && /^[A-Za-z_][A-Za-z0-9_:.-]*$/.test(currentEl.id)) {
          parts.unshift(`${tag}#${CSS.escape(currentEl.id)}`);
          break;
        }
        let segment = tag;
        if (currentEl.classList && currentEl.classList.length > 0) {
          const className = [...currentEl.classList].find(name => /^[A-Za-z_][A-Za-z0-9_-]*$/.test(name));
          if (className) {
            segment += `.${CSS.escape(className)}`;
          }
        }
        const parent = currentEl.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(item => item.tagName === currentEl.tagName);
          if (siblings.length > 1) {
            segment += `:nth-of-type(${siblings.indexOf(currentEl) + 1})`;
          }
        }
        parts.unshift(segment);
        currentEl = parent;
      }
      return parts.join(" > ");
    }

    function buildXPath(el) {
      if (!(el instanceof Element)) {
        return "";
      }
      if (el.id) {
        return `//*[@id="${q(el.id)}"]`;
      }
      const segments = [];
      let currentEl = el;
      while (currentEl && currentEl.nodeType === Node.ELEMENT_NODE) {
        const tag = currentEl.tagName.toLowerCase();
        const parent = currentEl.parentElement;
        if (!parent) {
          segments.unshift(tag);
          break;
        }
        const siblings = Array.from(parent.children).filter(item => item.tagName === currentEl.tagName);
        const index = siblings.indexOf(currentEl) + 1;
        segments.unshift(`${tag}[${index}]`);
        currentEl = parent;
      }
      return `/${segments.join("/")}`;
    }

    function inferRole(el) {
      const explicit = safeText(el.getAttribute("role"));
      if (explicit) {
        return explicit;
      }
      const tag = el.tagName.toLowerCase();
      if (tag === "button") {
        return "button";
      }
      if (tag === "a" && safeText(el.getAttribute("href"))) {
        return "link";
      }
      if (tag === "input") {
        const type = safeText(el.getAttribute("type")).toLowerCase();
        if (type === "button" || type === "submit" || type === "reset") {
          return "button";
        }
        if (type === "checkbox") {
          return "checkbox";
        }
        if (type === "radio") {
          return "radio";
        }
        return "textbox";
      }
      if (tag === "textarea") {
        return "textbox";
      }
      if (tag === "select") {
        return "combobox";
      }
      return "";
    }

    function inferName(el) {
      const attrs = [
        el.getAttribute("aria-label"),
        el.getAttribute("title"),
        el.getAttribute("placeholder"),
        el.getAttribute("name"),
        el.textContent
      ];
      for (const item of attrs) {
        const text = safeText(item || "");
        if (text) {
          return text.slice(0, 120);
        }
      }
      return "";
    }

    function buildCandidates(el) {
      const candidates = [];
      const id = safeText(el.getAttribute("id"));
      const dataTestId = safeText(el.getAttribute("data-testid"));
      const ariaLabel = safeText(el.getAttribute("aria-label"));
      const nameAttr = safeText(el.getAttribute("name"));
      const role = inferRole(el);
      const name = inferName(el);
      const text = safeText(el.textContent || "");
      if (role && name) {
        addCandidate(candidates, "playwright", `role=${role}[name="${q(name)}"]`, 0.98);
      }
      if (id) {
        addCandidate(candidates, "css", `#${CSS.escape(id)}`, 0.96);
      }
      if (dataTestId) {
        addCandidate(candidates, "css", `[data-testid="${q(dataTestId)}"]`, 0.93);
      }
      if (ariaLabel) {
        addCandidate(candidates, "css", `[aria-label="${q(ariaLabel)}"]`, 0.9);
      }
      if (nameAttr) {
        addCandidate(candidates, "css", `[name="${q(nameAttr)}"]`, 0.88);
      }
      if (text) {
        addCandidate(candidates, "text", `text=${text.slice(0, 80)}`, 0.7);
      }
      const cssPath = buildCssPath(el);
      if (cssPath) {
        addCandidate(candidates, "css", cssPath, 0.62);
      }
      const xpath = buildXPath(el);
      if (xpath) {
        addCandidate(candidates, "xpath", xpath, 0.45);
      }
      if (candidates.length > 0) {
        candidates[0].primary = true;
      }
      return candidates;
    }

    function elementMeta(el) {
      const rect = el.getBoundingClientRect();
      return {
        tagName: (el.tagName || "").toLowerCase(),
        id: safeText(el.getAttribute("id") || ""),
        className: safeText(el.className || ""),
        name: safeText(el.getAttribute("name") || ""),
        text: safeText(el.textContent || "").slice(0, 120),
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    }

    function setStatus(text) {
      if (!(state.toolbarStatus instanceof HTMLElement)) {
        return;
      }
      state.toolbarStatus.textContent = text;
    }

    function ensureUi() {
      if (state.overlay && state.outlineEl && state.toolbarRoot) {
        return;
      }

      const overlay = document.createElement("div");
      overlay.setAttribute("data-rpa-picker-ui", "overlay");
      overlay.style.position = "fixed";
      overlay.style.left = "0";
      overlay.style.top = "0";
      overlay.style.width = "100%";
      overlay.style.height = "100%";
      overlay.style.pointerEvents = "none";
      overlay.style.zIndex = "2147483646";
      overlay.style.background = "rgba(20, 30, 60, 0.06)";

      const outlineEl = document.createElement("div");
      outlineEl.setAttribute("data-rpa-picker-ui", "outline");
      outlineEl.style.position = "fixed";
      outlineEl.style.pointerEvents = "none";
      outlineEl.style.border = "2px solid #ff7a00";
      outlineEl.style.background = "rgba(255, 122, 0, 0.14)";
      outlineEl.style.borderRadius = "4px";
      outlineEl.style.display = "none";
      outlineEl.style.zIndex = "2147483647";

      const toolbar = document.createElement("div");
      toolbar.setAttribute("data-rpa-picker-ui", "toolbar");
      toolbar.style.position = "fixed";
      toolbar.style.left = "50%";
      toolbar.style.top = "10px";
      toolbar.style.transform = "translateX(-50%)";
      toolbar.style.zIndex = "2147483647";
      toolbar.style.pointerEvents = "auto";
      toolbar.style.display = "flex";
      toolbar.style.alignItems = "center";
      toolbar.style.gap = "10px";
      toolbar.style.padding = "8px 12px";
      toolbar.style.background = "rgba(17, 24, 39, 0.92)";
      toolbar.style.border = "1px solid rgba(148, 163, 184, 0.45)";
      toolbar.style.borderRadius = "10px";
      toolbar.style.color = "#e2e8f0";
      toolbar.style.fontSize = "12px";
      toolbar.style.fontFamily = "Segoe UI, Arial, sans-serif";
      toolbar.style.boxShadow = "0 10px 30px rgba(15, 23, 42, 0.35)";

      const status = document.createElement("span");
      status.setAttribute("data-rpa-picker-ui", "status");
      status.textContent = "拾取模式已启动：点击页面元素，Esc 取消";

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.setAttribute("data-rpa-picker-ui", "cancel");
      cancelBtn.textContent = "取消";
      cancelBtn.style.padding = "4px 8px";
      cancelBtn.style.borderRadius = "6px";
      cancelBtn.style.border = "1px solid rgba(148, 163, 184, 0.6)";
      cancelBtn.style.background = "rgba(30, 41, 59, 0.9)";
      cancelBtn.style.color = "#f8fafc";
      cancelBtn.style.cursor = "pointer";

      cancelBtn.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (typeof window.__rpaPickerCancel === "function") {
          window.__rpaPickerCancel({ reason: "User cancelled from picker toolbar." });
        }
        cleanup();
      }, true);

      toolbar.appendChild(status);
      toolbar.appendChild(cancelBtn);

      document.documentElement.appendChild(overlay);
      document.documentElement.appendChild(outlineEl);
      document.documentElement.appendChild(toolbar);

      state.overlay = overlay;
      state.outlineEl = outlineEl;
      state.toolbarRoot = toolbar;
      state.toolbarStatus = status;
      state.prevCursor = document.documentElement.style.cursor || "";
      document.documentElement.style.cursor = "crosshair";
    }

    function isUiElement(target) {
      if (!(target instanceof Element)) {
        return false;
      }
      return Boolean(target.closest('[data-rpa-picker-ui]'));
    }

    function resolveTargetFromEvent(event) {
      if (typeof event.composedPath === "function") {
        const path = event.composedPath();
        for (const item of path) {
          if (item instanceof Element) {
            return item;
          }
        }
      }
      return event.target instanceof Element ? event.target : null;
    }

    function highlight(target) {
      ensureUi();
      if (!state.outlineEl || !(target instanceof Element)) {
        return;
      }
      const rect = target.getBoundingClientRect();
      state.outlineEl.style.left = `${Math.round(rect.left)}px`;
      state.outlineEl.style.top = `${Math.round(rect.top)}px`;
      state.outlineEl.style.width = `${Math.max(1, Math.round(rect.width))}px`;
      state.outlineEl.style.height = `${Math.max(1, Math.round(rect.height))}px`;
      state.outlineEl.style.display = "block";

      const tag = (target.tagName || "").toLowerCase();
      const id = safeText(target.getAttribute("id") || "");
      setStatus(id ? `当前: ${tag}#${id}` : `当前: ${tag || "element"}`);
    }

    function cleanup() {
      window.removeEventListener("mousemove", onMouseMove, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      if (state.overlay && state.overlay.parentNode) {
        state.overlay.parentNode.removeChild(state.overlay);
      }
      if (state.outlineEl && state.outlineEl.parentNode) {
        state.outlineEl.parentNode.removeChild(state.outlineEl);
      }
      if (state.toolbarRoot && state.toolbarRoot.parentNode) {
        state.toolbarRoot.parentNode.removeChild(state.toolbarRoot);
      }
      if (state.prevCursor !== null) {
        document.documentElement.style.cursor = state.prevCursor;
      }
      state.overlay = null;
      state.outlineEl = null;
      state.toolbarRoot = null;
      state.toolbarStatus = null;
      state.active = null;
      state.installed = false;
      window.__rpaDesktopPickerInstalled = false;
      window.__rpaDesktopPickerState = null;
    }

    function submit(target) {
      const candidates = buildCandidates(target);
      if (candidates.length === 0) {
        if (typeof window.__rpaPickerCancel === "function") {
          window.__rpaPickerCancel({ reason: "No selector candidates found." });
        }
        cleanup();
        return;
      }
      const primary = candidates[0];
      const playwrightCandidates = candidates.filter(item => item.type === "playwright" || item.type === "role");
      const payload = {
        selector: primary.value,
        selectorType: primary.type,
        selectorCandidates: candidates,
        playwrightPrimary: playwrightCandidates[0] || null,
        playwrightCandidates,
        elementMeta: elementMeta(target),
        pageUrl: window.location.href
      };
      setStatus("已选中元素，正在回传结果...");
      if (typeof window.__rpaPickerSubmit === "function") {
        window.__rpaPickerSubmit(payload);
      }
      cleanup();
    }

    function onMouseMove(event) {
      const target = resolveTargetFromEvent(event);
      if (!(target instanceof Element) || isUiElement(target)) {
        return;
      }
      state.active = target;
      state.mouseMoves += 1;
      highlight(target);
    }

    function onClick(event) {
      const target = resolveTargetFromEvent(event);
      if (!(target instanceof Element)) {
        return;
      }
      if (isUiElement(target)) {
        return;
      }
      state.interceptedClicks += 1;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      submit(target);
    }

    function onKeyDown(event) {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setStatus("已取消");
      if (typeof window.__rpaPickerCancel === "function") {
        window.__rpaPickerCancel({ reason: "User pressed Escape." });
      }
      cleanup();
    }

    ensureUi();
    window.addEventListener("mousemove", onMouseMove, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);

    return { status: "installed", installedAt: state.installedAt };
  } catch (error) {
    return { status: "error", reason: String(error) };
  }
})();