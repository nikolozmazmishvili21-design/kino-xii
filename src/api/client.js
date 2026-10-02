import { API_BASE_URL } from "../config.js";

export class ApiError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);

    this.name = "ApiError";

    if (options.status !== undefined) {
      this.status = options.status;
    }

    if (options.data !== undefined) {
      this.data = options.data;
    }

    if (options.errors !== undefined) {
      this.errors = options.errors;
    }

    if (options.contested !== undefined) {
      this.contested = options.contested;
    }
  }
}

function buildUrl(path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  return `${API_BASE_URL}${normalizedPath}`;
}

async function parseResponseBody(response) {
  if (response.status === 204) {
    return null;
  }

  const text = await response.text();

  if (!text) {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return text;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function createHttpError(response, data) {
  const message =
    data &&
    typeof data === "object" &&
    typeof data.message === "string"
      ? data.message
      : `Request failed with status ${response.status}.`;

  const options = {
    status: response.status,
    data,
  };

  if (
    data &&
    typeof data === "object" &&
    Object.hasOwn(data, "errors")
  ) {
    options.errors = data.errors;
  }

  if (
    data &&
    typeof data === "object" &&
    Object.hasOwn(data, "contested")
  ) {
    options.contested = data.contested;
  }

  return new ApiError(message, options);
}

export async function apiRequest(
  path,
  {
    method = "GET",
    body,
    token,
    signal,
    headers,
  } = {},
) {
  const requestHeaders = new Headers(headers);

  if (!requestHeaders.has("Accept")) {
    requestHeaders.set("Accept", "application/json");
  }

  if (token) {
    requestHeaders.set("Authorization", `Bearer ${token}`);
  }

  let requestBody = body;

  if (body !== undefined && body !== null && !(body instanceof FormData)) {
    if (!requestHeaders.has("Content-Type")) {
      requestHeaders.set("Content-Type", "application/json");
    }

    requestBody = JSON.stringify(body);
  }

  try {
    const response = await fetch(buildUrl(path), {
      method,
      headers: requestHeaders,
      body: requestBody,
      signal,
    });

    const data = await parseResponseBody(response);

    if (!response.ok) {
      throw createHttpError(response, data);
    }

    return {
      status: response.status,
      data,
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw error;
    }

    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError("Network request failed.", {
      cause: error,
    });
  }
}