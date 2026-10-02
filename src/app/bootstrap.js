import { getFilterOptions } from "../api/sessionsApi.js";

let filterOptionsPromise = null;

export function bootstrapApp({ restoreSession } = {}) {
  if (!filterOptionsPromise) {
    filterOptionsPromise = loadFilterOptions().catch((error) => {
      filterOptionsPromise = null;
      throw error;
    });
  }

  // Cache successful filters for this app session, including provider remounts.
  // Each provider still restores its own authentication state.
  return Promise.all([filterOptionsPromise, restoreSession?.()]).then(
    ([filterOptions]) => ({ filterOptions }),
  );
}

async function loadFilterOptions() {
  const filterOptions = await getFilterOptions();

  if (!filterOptions) {
    throw new Error("Filter options response did not contain data.");
  }

  return filterOptions;
}
