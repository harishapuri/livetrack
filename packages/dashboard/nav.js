/**
 * Single-shell dashboard routing.
 * Hash routes: #/executions #/analytics #/digest #/studio #/approvals #/assignments #/reviews #/converter
 * Legacy paths (/queue-studio/, /assignments/, …) are redirected by the server.
 */
(function () {
  const ROUTES = {
    executions: "Executions",
    analytics: "Analytics",
    digest: "Weekly digest",
    studio: "Queue studio",
    approvals: "Waiting for SME approval",
    assignments: "Assignments",
    reviews: "Reviews & governance",
    converter: "SOP converter",
  };

  const LEGACY = {
    "queue-studio": "studio",
    approvals: "approvals",
    assignments: "assignments",
    converter: "converter",
    digest: "digest",
    reviews: "reviews",
    analytics: "analytics",
  };

  function parseHash() {
    const path = location.pathname.replace(/\\/g, "/");
    for (const [folder, id] of Object.entries(LEGACY)) {
      if (path.includes(`/${folder}`)) return { id, query: new URLSearchParams() };
    }
    const raw = (location.hash || "").replace(/^#\/?/, "");
    const qIndex = raw.indexOf("?");
    const pathPart = (qIndex >= 0 ? raw.slice(0, qIndex) : raw).split("/")[0];
    const qs = qIndex >= 0 ? raw.slice(qIndex + 1) : "";
    const id = pathPart && ROUTES[pathPart] ? pathPart : "executions";
    return { id, query: new URLSearchParams(qs) };
  }

  function applyRoute(id, { push, query } = {}) {
    const route = ROUTES[id] ? id : "executions";
    const q = query instanceof URLSearchParams ? query : new URLSearchParams(query || "");
    const qs = q.toString();
    const hash = qs ? `#/${route}?${qs}` : `#/${route}`;
    if (push && location.hash !== hash) {
      history.replaceState(null, "", hash);
    }
    document.querySelectorAll("[data-pane]").forEach((pane) => {
      const on = pane.getAttribute("data-pane") === route;
      pane.hidden = !on;
    });
    document.querySelectorAll("[data-nav]").forEach((a) => {
      const key = a.getAttribute("data-nav");
      a.classList.toggle("active", key === route);
      a.setAttribute("href", `#/${key}`);
    });
    const sub = document.getElementById("pageSub");
    if (sub) sub.textContent = ROUTES[route];
    document.title = `LiveTrack — ${ROUTES[route]}`;
    window.dispatchEvent(
      new CustomEvent("dash:route", {
        detail: { id: route, query: Object.fromEntries(q.entries()) },
      })
    );
  }

  window.dashNavigate = applyRoute;

  document.querySelectorAll("[data-nav]").forEach((a) => {
    a.addEventListener("click", (e) => {
      const key = a.getAttribute("data-nav");
      if (!ROUTES[key]) return;
      e.preventDefault();
      applyRoute(key, { push: true, query: new URLSearchParams() });
    });
  });

  window.addEventListener("hashchange", () => {
    const { id, query } = parseHash();
    applyRoute(id, { query });
  });
  const first = parseHash();
  applyRoute(first.id, { push: true, query: first.query });
})();
