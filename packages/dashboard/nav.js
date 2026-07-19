/**
 * Resolve dashboard nav for both http://127.0.0.1:4175 and file:// opens.
 */
(function () {
  const file = location.protocol === "file:";
  const path = location.pathname.replace(/\\/g, "/");
  const inStudio = /\/queue-studio(\/|$)/.test(path) || /queue-studio\/index\.html$/i.test(path);
  const inAssignments =
    /\/assignments(\/|$)/.test(path) || /assignments\/index\.html$/i.test(path);
  const inConverter =
    /\/converter(\/|$)/.test(path) || /converter\/index\.html$/i.test(path);

  let links;
  if (file) {
    if (inStudio) {
      links = {
        executions: "../index.html",
        studio: "./index.html",
        assignments: "../assignments/index.html",
        converter: "../converter/index.html",
      };
    } else if (inAssignments) {
      links = {
        executions: "../index.html",
        studio: "../queue-studio/index.html",
        assignments: "./index.html",
        converter: "../converter/index.html",
      };
    } else if (inConverter) {
      links = {
        executions: "../index.html",
        studio: "../queue-studio/index.html",
        assignments: "../assignments/index.html",
        converter: "./index.html",
      };
    } else {
      links = {
        executions: "./index.html",
        studio: "./queue-studio/index.html",
        assignments: "./assignments/index.html",
        converter: "./converter/index.html",
      };
    }
  } else {
    links = {
      executions: "/",
      studio: "/queue-studio/",
      assignments: "/assignments/",
      converter: "/converter/",
    };
  }

  document.querySelectorAll("[data-nav]").forEach((a) => {
    const key = a.getAttribute("data-nav");
    if (links[key]) a.setAttribute("href", links[key]);
  });
})();
