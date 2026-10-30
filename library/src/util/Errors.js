/** Errors with a stable code the UI can translate (error.<code>). */
const Errors = (function () {
  function make(code, message, details) {
    const err = new Error(message || code);
    err.code = code;
    if (details) err.details = details;
    return err;
  }

  return { make: make };
})();
