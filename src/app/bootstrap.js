import { getFilterOptions } from "../api/sessionsApi.js";

let activeBootPromise = null;

export function bootstrapApp({ signal } = {}) {
  if (!activeBootPromise) {
    activeBootPromise = runBootstrap({ signal }).finally(() => {
      activeBootPromise = null;
    });
  }

  return activeBootPromise;
}

async function runBootstrap({ signal }) {
  const filterOptions = await getFilterOptions({ signal });

  if (!filterOptions) {
    throw new Error("Filter options response did not contain data.");
  }

  return {
    filterOptions,
  };
}