import { apiRequest } from "./client.js";

export async function register(
  { username, email, password, password_confirmation, avatar },
  { signal } = {},
) {
  const body = new FormData();

  body.append("username", username);
  body.append("email", email);
  body.append("password", password);
  body.append("password_confirmation", password_confirmation);

  if (avatar != null) {
    body.append("avatar", avatar);
  }

  const response = await apiRequest("/register", {
    method: "POST",
    body,
    token: null,
    signal,
  });

  return response.data;
}

export async function login({ email, password }, { signal } = {}) {
  const response = await apiRequest("/login", {
    method: "POST",
    body: { email, password },
    token: null,
    signal,
  });

  return response.data;
}

export async function logout({ token, signal } = {}) {
  const response = await apiRequest("/logout", {
    method: "POST",
    token,
    signal,
  });

  return response.data;
}

export async function me({ token, signal } = {}) {
  const response = await apiRequest("/me", { token, signal });

  return response.data;
}
