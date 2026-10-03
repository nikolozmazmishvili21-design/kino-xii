export function getAuthFormErrors(error, fieldNames, fallbackMessage) {
  const fieldErrors = {};
  const unknownMessages = [];

  if (error.status === 422 && error.errors) {
    for (const name of fieldNames) {
      const messages = error.errors[name];
      const strings = Array.isArray(messages) ? messages : [messages];
      const relevant = strings.filter((message) => typeof message === "string" && message);
      if (relevant.length) fieldErrors[name] = relevant;
    }
    for (const [name, messages] of Object.entries(error.errors)) {
      if (fieldNames.includes(name)) continue;
      const strings = Array.isArray(messages) ? messages : [messages];
      unknownMessages.push(...strings.filter((message) => typeof message === "string" && message));
    }
  }

  const hasFieldErrors = Object.keys(fieldErrors).length > 0;
  const serverMessage = typeof error.message === "string" ? error.message : fallbackMessage;

  return {
    fieldErrors,
    message: unknownMessages.length
      ? unknownMessages
      : hasFieldErrors
        ? ""
        : error.status >= 400 && error.status < 500
          ? serverMessage
          : fallbackMessage,
  };
}
