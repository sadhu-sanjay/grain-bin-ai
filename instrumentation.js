export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { warmLinksIndex } = await import("./lib/microsoftBuildings.js");
    warmLinksIndex();
  }
}