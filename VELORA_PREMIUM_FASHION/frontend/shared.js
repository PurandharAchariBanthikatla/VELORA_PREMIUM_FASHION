/**
 * Shared across index.html, account.html, and admin/*.html so the same
 * money/escapeHtml/toast/API-client logic isn't copy-pasted three times.
 * Loaded as a plain <script> (not a module) so one file works from both
 * /frontend and /frontend/admin without relative-import path juggling.
 */
window.Velora = (function () {
  const API_BASE = window.VELORA_API_BASE || "";
  let csrfToken = "";

  async function ensureCsrf() {
    const response = await fetch(`${API_BASE}/api/csrf`, {
      method: "GET",
      credentials: "include",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("Unable to obtain CSRF token");
    }

    const data = await response.json();

    if (!data.csrfToken) {
      throw new Error("CSRF token was not returned by the server");
    }

    csrfToken = data.csrfToken;

    return csrfToken;
  }

  function money(value) {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0
    }).format(value || 0);
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function toast(message, isError) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = message;
    el.classList.toggle("error", Boolean(isError));
    el.classList.add("show");
    window.clearTimeout(el._timer);
    el._timer = window.setTimeout(() => el.classList.remove("show"), 3200);
  }

  // ---- Session storage ----

  const auth = {
    getAccessToken: () => localStorage.getItem("veloraToken"),
    getRefreshToken: () => localStorage.getItem("veloraRefreshToken"),
    getUser: () => JSON.parse(localStorage.getItem("veloraUser") || "null"),
    setSession({ token, refreshToken, user }) {
      if (token) localStorage.setItem("veloraToken", token);
      if (refreshToken) localStorage.setItem("veloraRefreshToken", refreshToken);
      if (user) localStorage.setItem("veloraUser", JSON.stringify(user));
    },
    clearSession() {
      localStorage.removeItem("veloraToken");
      localStorage.removeItem("veloraRefreshToken");
      localStorage.removeItem("veloraUser");
    }
  };

  // Called when a refresh attempt fails and the session truly needs to end.
  // Pages can override this (e.g. account.html/admin redirect; index.html
  // just clears local state and lets the user keep browsing as a guest).
  let onSessionExpired = () => {
    auth.clearSession();
  };
  function setSessionExpiredHandler(fn) {
    onSessionExpired = fn;
  }

  let refreshPromise = null;

  async function rawFetch(path, options) {
    const response = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      ...options
    });
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    return { response, data };
  }

  async function tryRefresh() {
    const refreshToken = auth.getRefreshToken();
    if (!refreshToken) return false;

    if (!refreshPromise) {
      refreshPromise = rawFetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken })
      }).finally(() => {
        refreshPromise = null;
      });
    }

    const { response, data } = await refreshPromise;
    if (!response.ok) return false;

    auth.setSession({ token: data.token, refreshToken: data.refreshToken, user: data.user });
    return true;
  }

  /**
   * Core API client. Attaches the access token automatically, and if a
   * request comes back 401, tries exactly one silent refresh-and-retry
   * before giving up (so a user's 15-minute access token doesn't visibly
   * log them out mid-session).
   */
  async function api(path, options = {}) {
    const { skipAuth, body, headers, ...rest } = options;
    const token = auth.getAccessToken();

    const buildHeaders = async () => ({
      "Content-Type": "application/json",
      ...(token && !skipAuth ? { Authorization: `Bearer ${token}` } : {}),
      ...(rest.method && rest.method !== 'GET' ? { 'X-CSRF-Token': await ensureCsrf() } : {}),
      ...(headers || {})
    });

    let { response, data } = await rawFetch(path, {
      ...rest,
      headers: await buildHeaders(),
      body: body ? JSON.stringify(body) : undefined
    });

    if (response.status === 401 && !skipAuth && auth.getRefreshToken()) {
      const refreshed = await tryRefresh();
      if (refreshed) {
        const retryHeaders = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.getAccessToken()}`,
          ...(headers || {}),
          'X-CSRF-Token': await ensureCsrf()
        };
        ({ response, data } = await rawFetch(path, {
          ...rest,
          headers: retryHeaders,
          body: body ? JSON.stringify(body) : undefined
        }));
      } else {
        onSessionExpired();
      }
    } else if (response.status === 401 && !skipAuth) {
      onSessionExpired();
    }

    if (!response.ok) {
      throw new Error(data.message || "Something went wrong. Please try again.");
    }
    return data;
  }

  // ---- Safety net for the pre-reveal fade (see body:has(#loader) in CSS) ----
  // Pages with a splash loader (the storefront) are responsible for adding
  // "page-ready" once their own data has loaded. Every other page should
  // never have been hidden in the first place, but this guarantees no page
  // can ever get stuck invisible even if a browser lacks :has() support or a
  // future page forgets to add the class.
  function ensurePageReveal() {
    if (!document.getElementById("loader")) {
      document.body.classList.add("page-ready");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensurePageReveal);
  } else {
    ensurePageReveal();
  }

  // ---- Scroll-reveal ----
  // Elements with [data-reveal] fade/slide into view the first time they
  // enter the viewport. One shared observer, reused across every page.
  function initScrollReveal() {
    const targets = document.querySelectorAll("[data-reveal]");
    if (targets.length === 0) return;

    if (!("IntersectionObserver" in window)) {
      targets.forEach((el) => el.classList.add("in-view"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
    );

    targets.forEach((el) => observer.observe(el));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initScrollReveal);
  } else {
    initScrollReveal();
  }

  // ---- Animated number count-up (dashboards) ----
  // Call after setting an element's final text to a number/currency string;
  // it re-animates from 0 up to that value. Safe to call repeatedly (e.g. on
  // every stats refresh) — each call restarts its own animation cleanly.
  function animateCount(el, endValue, { duration = 800, formatter } = {}) {
    if (!el || !Number.isFinite(endValue)) return;
    const format = formatter || ((n) => Math.round(n).toLocaleString("en-IN"));
    const startValue = 0;
    const startTime = performance.now();

    function tick(now) {
      const progress = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out-cubic
      el.textContent = format(startValue + (endValue - startValue) * eased);
      if (progress < 1) window.requestAnimationFrame(tick);
      else el.textContent = format(endValue);
    }
    window.requestAnimationFrame(tick);
  }

  // ---- Minimal modal helper (review forms, return requests, etc.) ----
  function openModal(innerHtml) {
    closeModal();
    const overlay = document.createElement("div");
    overlay.className = "v-modal-overlay";
    overlay.id = "vModalOverlay";
    overlay.innerHTML = `<div class="v-modal-box">${innerHtml}</div>`;
    overlay.addEventListener("click", (event) => { if (event.target === overlay) closeModal(); });
    document.body.appendChild(overlay);
    return overlay;
  }
  function closeModal() {
    document.getElementById("vModalOverlay")?.remove();
  }

  // Downloads an authenticated binary response (e.g. an invoice PDF) as a
  // file, since the plain <a href> download attribute can't attach an
  // Authorization header the way the rest of the API client does.
  async function downloadFile(path, filename) {
    const token = auth.getAccessToken();
    const response = await fetch(`${API_BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || "Could not download the file.");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return { API_BASE, money, escapeHtml, toast, auth, api, ensureCsrf, setSessionExpiredHandler, animateCount, openModal, closeModal, downloadFile };
})();
