/**
 * Shared across index.html, account.html, and admin/*.html so the same
 * money/escapeHtml/toast/API-client logic isn't copy-pasted three times.
 * Loaded as a plain <script> (not a module) so one file works from both
 * /frontend and /frontend/admin without relative-import path juggling.
 */
window.Velora = (function () {
  const API_BASE = window.VELORA_API_BASE || "";

  // Keep CSRF token in memory only.
  // The server-side velora_csrf cookie is sent automatically with credentials: "include".
  let csrfToken = "";

  async function ensureCsrf() {
    if (csrfToken) return csrfToken;

    const response = await fetch(`${API_BASE}/api/csrf`, {
      credentials: "include"
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

    el._timer = window.setTimeout(() => {
      el.classList.remove("show");
    }, 3200);
  }

  // ---- Session storage ----

  const auth = {
    getAccessToken: () => localStorage.getItem("veloraToken"),

    getRefreshToken: () =>
      localStorage.getItem("veloraRefreshToken"),

    getUser: () =>
      JSON.parse(localStorage.getItem("veloraUser") || "null"),

    setSession({ token, refreshToken, user }) {
      if (token) {
        localStorage.setItem("veloraToken", token);
      }

      if (refreshToken) {
        localStorage.setItem(
          "veloraRefreshToken",
          refreshToken
        );
      }

      if (user) {
        localStorage.setItem(
          "veloraUser",
          JSON.stringify(user)
        );
      }
    },

    clearSession() {
      localStorage.removeItem("veloraToken");
      localStorage.removeItem("veloraRefreshToken");
      localStorage.removeItem("veloraUser");
    }
  };

  let onSessionExpired = () => {
    auth.clearSession();
  };

  function setSessionExpiredHandler(fn) {
    onSessionExpired = fn;
  }

  let refreshPromise = null;

  // ---- Raw API request ----

  async function rawFetch(path, options = {}) {
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

    return {
      response,
      data
    };
  }

  // ---- Refresh authentication session ----

  async function tryRefresh() {
    const refreshToken = auth.getRefreshToken();

    if (!refreshToken) {
      return false;
    }

    if (!refreshPromise) {
      refreshPromise = rawFetch("/api/auth/refresh", {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          refreshToken
        })
      }).finally(() => {
        refreshPromise = null;
      });
    }

    const {
      response,
      data
    } = await refreshPromise;

    if (!response.ok) {
      return false;
    }

    auth.setSession({
      token: data.token,
      refreshToken: data.refreshToken,
      user: data.user
    });

    return true;
  }

  /**
   * Core API client.
   *
   * Automatically:
   * - sends cookies
   * - sends access token
   * - obtains CSRF token for mutating requests
   * - sends X-CSRF-Token
   * - refreshes expired access tokens once
   */
  async function api(path, options = {}) {
    const {
      skipAuth,
      body,
      headers,
      ...rest
    } = options;

    const token = auth.getAccessToken();

    const buildHeaders = async () => {
      const requestHeaders = {
        "Content-Type": "application/json"
      };

      if (token && !skipAuth) {
        requestHeaders.Authorization =
          `Bearer ${token}`;
      }

      // Every mutating authenticated/public API request
      // must include the CSRF token.
      if (
        !skipAuth &&
        rest.method &&
        rest.method !== "GET" &&
        rest.method !== "HEAD"
      ) {
        requestHeaders["X-CSRF-Token"] =
          await ensureCsrf();
      }

      return {
        ...requestHeaders,
        ...(headers || {})
      };
    };

    let {
      response,
      data
    } = await rawFetch(path, {
      ...rest,

      headers: await buildHeaders(),

      body: body
        ? JSON.stringify(body)
        : undefined
    });

    // Access token expired.
    // Refresh once and retry.
    if (
      response.status === 401 &&
      !skipAuth &&
      auth.getRefreshToken()
    ) {
      const refreshed = await tryRefresh();

      if (refreshed) {
        const retryHeaders = {
          "Content-Type": "application/json",

          Authorization:
            `Bearer ${auth.getAccessToken()}`,

          "X-CSRF-Token":
            await ensureCsrf(),

          ...(headers || {})
        };

        ({
          response,
          data
        } = await rawFetch(path, {
          ...rest,

          headers: retryHeaders,

          body: body
            ? JSON.stringify(body)
            : undefined
        }));
      } else {
        onSessionExpired();
      }
    } else if (
      response.status === 401 &&
      !skipAuth
    ) {
      onSessionExpired();
    }

    if (!response.ok) {
      throw new Error(
        data.message ||
        "Something went wrong. Please try again."
      );
    }

    return data;
  }

  // ---- Safety net for page reveal ----

  function ensurePageReveal() {
    if (!document.getElementById("loader")) {
      document.body.classList.add("page-ready");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      ensurePageReveal
    );
  } else {
    ensurePageReveal();
  }

  // ---- Scroll reveal ----

  function initScrollReveal() {
    const targets =
      document.querySelectorAll("[data-reveal]");

    if (targets.length === 0) {
      return;
    }

    if (!("IntersectionObserver" in window)) {
      targets.forEach((el) => {
        el.classList.add("in-view");
      });

      return;
    }

    const observer =
      new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add(
                "in-view"
              );

              observer.unobserve(
                entry.target
              );
            }
          });
        },
        {
          threshold: 0.15,
          rootMargin:
            "0px 0px -40px 0px"
        }
      );

    targets.forEach((el) => {
      observer.observe(el);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initScrollReveal
    );
  } else {
    initScrollReveal();
  }

  // ---- Animated number count-up ----

  function animateCount(
    el,
    endValue,
    {
      duration = 800,
      formatter
    } = {}
  ) {
    if (
      !el ||
      !Number.isFinite(endValue)
    ) {
      return;
    }

    const format =
      formatter ||
      ((n) =>
        Math.round(n)
          .toLocaleString("en-IN"));

    const startValue = 0;
    const startTime = performance.now();

    function tick(now) {
      const progress =
        Math.min(
          1,
          (now - startTime) /
            duration
        );

      const eased =
        1 -
        Math.pow(
          1 - progress,
          3
        );

      el.textContent =
        format(
          startValue +
          (endValue - startValue) *
            eased
        );

      if (progress < 1) {
        window.requestAnimationFrame(
          tick
        );
      } else {
        el.textContent =
          format(endValue);
      }
    }

    window.requestAnimationFrame(tick);
  }

  // ---- Modal helper ----

  function openModal(innerHtml) {
    closeModal();

    const overlay =
      document.createElement("div");

    overlay.className =
      "v-modal-overlay";

    overlay.id =
      "vModalOverlay";

    overlay.innerHTML =
      `<div class="v-modal-box">${innerHtml}</div>`;

    overlay.addEventListener(
      "click",
      (event) => {
        if (
          event.target === overlay
        ) {
          closeModal();
        }
      }
    );

    document.body.appendChild(
      overlay
    );

    return overlay;
  }

  function closeModal() {
    document
      .getElementById(
        "vModalOverlay"
      )
      ?.remove();
  }

  // ---- Authenticated file download ----

  async function downloadFile(
    path,
    filename
  ) {
    const token =
      auth.getAccessToken();

    const response =
      await fetch(
        `${API_BASE}${path}`,
        {
          credentials: "include",

          headers: token
            ? {
                Authorization:
                  `Bearer ${token}`
              }
            : {}
        }
      );

    if (!response.ok) {
      const data =
        await response
          .json()
          .catch(() => ({}));

      throw new Error(
        data.message ||
        "Could not download the file."
      );
    }

    const blob =
      await response.blob();

    const url =
      URL.createObjectURL(blob);

    const a =
      document.createElement("a");

    a.href = url;
    a.download = filename;

    document.body.appendChild(a);

    a.click();

    a.remove();

    URL.revokeObjectURL(url);
  }

  return {
    API_BASE,
    money,
    escapeHtml,
    toast,
    auth,
    api,
    ensureCsrf,
    setSessionExpiredHandler,
    animateCount,
    openModal,
    closeModal,
    downloadFile
  };
})();
