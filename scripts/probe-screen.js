const { app, screen } = require("electron");
app.whenReady().then(() => {
  for (const d of screen.getAllDisplays()) {
    console.log(JSON.stringify({
      id: d.id,
      bounds: d.bounds,
      workArea: d.workArea,
      scale: d.scaleFactor,
      primary: d.id === screen.getPrimaryDisplay().id
    }));
  }
  app.quit();
});
