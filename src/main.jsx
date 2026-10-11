// Load app CSS with the app module, without blocking the HTML shell's first paint.
// Rejections remain visible to the browser and the early HTML failure handler.
void import("./mountApp.jsx");
