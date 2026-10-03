const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"];
const AVATAR_EXTENSION = /\.(jpe?g|png|webp)$/i;
const MAX_AVATAR_SIZE = 2 * 1024 * 1024;

function validateEmail(email) {
  if (!email) return "Email is required";
  if (!EMAIL_FORMAT.test(email)) return "Please enter a valid email address";
  return null;
}

function validatePassword(password) {
  if (!password) return "Password is required";
  if (password.length < 3) return "Password must be at least 3 characters";
  return null;
}

export function validateAvatar(avatar) {
  if (!avatar) return null;
  const supported = avatar.type
    ? AVATAR_TYPES.includes(avatar.type)
    : AVATAR_EXTENSION.test(avatar.name);
  if (!supported) return "Avatar must be a JPG, JPEG, PNG or WEBP image";
  if (avatar.size > MAX_AVATAR_SIZE) return "Avatar must not exceed 2 MB";
  return null;
}

export function validateLogin(fields) {
  return {
    email: validateEmail(fields.email),
    password: validatePassword(fields.password),
  };
}

export function validateSignup(fields) {
  return {
    username: !fields.username
      ? "Username is required"
      : fields.username.length < 3
        ? "Username must be at least 3 characters"
        : null,
    email: validateEmail(fields.email),
    password: validatePassword(fields.password),
    password_confirmation: !fields.password_confirmation
      ? "Confirm password is required"
      : fields.password_confirmation !== fields.password
        ? "Passwords must match"
        : null,
    avatar: validateAvatar(fields.avatar),
  };
}
