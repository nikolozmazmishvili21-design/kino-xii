export function profileDraft(user) {
  return {
    fullName: user?.fullName ?? "",
    mobileNumber: user?.mobileNumber ?? "",
    dateOfBirth: user?.dateOfBirth ?? "",
    preferredVenueId: user?.preferredVenue?.id == null ? "" : String(user.preferredVenue.id),
  };
}

export function isProfileDirty(draft, baseline) {
  return Object.keys(baseline).some((field) => draft[field] !== baseline[field]);
}

export function profileEligibility(user, ageRatings) {
  if (user.profileComplete !== true || typeof user.age !== "number" || !Number.isFinite(user.age)) return null;
  const validRatings = ageRatings?.length > 0 && ageRatings.every((rating) =>
    typeof rating.minAge === "number" && Number.isFinite(rating.minAge) && rating.minAge >= 0);
  if (validRatings && user.age >= Math.max(...ageRatings.map((rating) => rating.minAge))) {
    return `You are ${user.age}, you can buy tickets for all age ratings.`;
  }
  return `Age on your account: ${user.age}. Film age restrictions are applied when booking.`;
}
