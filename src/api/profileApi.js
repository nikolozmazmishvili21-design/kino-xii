import { apiRequest } from "./client.js";
import { normalizeMobile } from "../validation/profileValidation.js";

// Called only after feature validation; an empty optional preference is omitted.
export function createProfilePayload(draft) {
  const body = new FormData();
  body.append("fullName", draft.fullName);
  body.append("mobileNumber", normalizeMobile(draft.mobileNumber));
  body.append("dateOfBirth", draft.dateOfBirth);
  if (draft.preferredVenueId !== "") {
    body.append("preferredVenueId", Number(draft.preferredVenueId));
  }
  return body;
}

export async function updateProfile(draft, { signal } = {}) {
  const response = await apiRequest("/profile", {
    method: "PUT",
    body: createProfilePayload(draft),
    signal,
  });
  return response.data.data;
}
