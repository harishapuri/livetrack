/**
 * Built-in Outlook / Entra app for LiveTrack MoM (public client, device code).
 * Client ID is not a secret. Override in Settings only if IT gives another app.
 *
 * App: "LiveTrack outlook" — must allow personal Microsoft accounts (or org + personal)
 * and Allow public client flows = Yes.
 */
module.exports = {
  /** Multi-account authority — personal Outlook + work */
  outlookTenantId: "common",
  /** LiveTrack outlook app registration */
  outlookClientId: "f081b9cd-fcad-45b2-b418-5bf68b546fd7",
  outlookAppName: "LiveTrack outlook",
};
