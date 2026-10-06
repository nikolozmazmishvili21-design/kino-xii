import { useEffect, useRef } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { useProfileAccess } from "../auth/ProfileAccessContext.js";
import { useAppBootstrap } from "../app/AppBootstrapContext.js";
import FormField from "../components/forms/FormField.jsx";
import Footer from "../components/Footer.jsx";
import completeIcon from "../assets/icons/profile-complete.svg";
import useProfileForm from "../profile/useProfileForm.js";
import { profileEligibility } from "../profile/profileForm.js";
import { useBooking } from "../booking/BookingContext.js";

export default function ProfilePage() {
  const { status, mutation } = useAuth();
  const { profileRemediationMessage } = useBooking();
  const { continuation, requestProfileAccess, finishProfileAccess } = useProfileAccess();
  const { filterOptions } = useAppBootstrap();
  const venues = filterOptions?.venues ?? [];
  const formRef = useRef(null);
  const form = useProfileForm(venues, formRef);

  useEffect(() => {
    if (status === "guest" && !mutation) requestProfileAccess();
    else if (status === "authenticated" && !mutation && continuation) finishProfileAccess();
  }, [status, mutation, continuation, requestProfileAccess, finishProfileAccess]);

  if (!form.user) {
    return <main className="profile-page"><p role="status">{status === "restoring" ? "Loading profile…" : "Please sign in to view your profile."}</p></main>;
  }

  const complete = form.user.profileComplete === true;
  const eligibility = profileEligibility(form.user, filterOptions?.ageRatings);
  return (
    <>
      <main className="profile-page">
        <header className="profile-page__header">
          <h1>My Profile</h1>
          <nav className="profile-page__navigation" aria-label="Profile">
            <span className="profile-page__active" aria-current="page">Personal Information</span>
            <button type="button" disabled>My Tickets</button>
          </nav>
        </header>
        <div className="profile-page__column">
          <div className={`profile-page__banner${complete ? " profile-page__banner--complete" : ""}`}>
            <p className="profile-page__status">{complete && <img src={completeIcon} alt="" aria-hidden="true" />}{complete ? "Profile Complete" : "Profile incomplete"}</p>
            {!complete && <p>Please complete your profile to enable booking.</p>}
            {!complete && profileRemediationMessage && <p role="alert">{profileRemediationMessage}</p>}
            {eligibility && <p>{eligibility}</p>}
          </div>
          <form className="profile-form" ref={formRef} onSubmit={form.submit} noValidate aria-label="Personal Information" aria-busy={form.pending}>
            <div className="profile-form__fields">
              <FormField label="Full Name" required autoComplete="name" placeholder="Full Name" {...form.fieldProps("fullName")} />
              <FormField label="Email" type="email" name="email" value={form.user.email} readOnly helperText="Set at registration and cannot be changed" />
              <FormField label="Mobile Number" required type="text" inputMode="tel" autoComplete="tel-national" placeholder="Mobile Number" {...form.fieldProps("mobileNumber")} />
              <FormField label="Date of Birth" required type="date" autoComplete="bday" {...form.fieldProps("dateOfBirth")} />
              <FormField label="Preferred Venue (Optional)" as="select" {...form.fieldProps("preferredVenueId")}>
                {form.baseline.preferredVenueId === "" && <option value="">Select venue</option>}
                {venues.map((venue) => <option key={venue.id} value={String(venue.id)}>{venue.name}</option>)}
              </FormField>
            </div>
            <button className="button button--primary profile-form__save" type="submit" disabled={!form.canSave}>{form.pending ? "Saving…" : "Save Changes"}</button>
            <div className="profile-form__feedback" role={form.feedback?.type === "error" ? "alert" : "status"} aria-live={form.feedback?.type === "error" ? "assertive" : "polite"}>
              {form.feedback?.message}
            </div>
          </form>
        </div>
      </main>
      <Footer />
    </>
  );
}
