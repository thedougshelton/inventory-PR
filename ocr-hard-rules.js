(() => {
  "use strict";

  const FORBIDDEN_LETTERS = new Set(["A", "E", "F", "G", "H", "I", "J", "K", "L", "N", "O", "Q", "U", "V", "W", "X", "Y"]);
  const VALID_NUMERIC_STARTS = new Set(["3", "7", "8"]);
  const VALID_CONTAINER_CODE = /^(?:D\d{5}|B\d{5}|C\d{5}|ZM\d{4}|[378]\d{5})$/;

  const normalize = value => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);

  const validationMessage = value => {
    const code = normalize(value);
    if (!code) return "";

    const forbidden = [...code].find(character => FORBIDDEN_LETTERS.has(character));
    if (forbidden) return forbidden + " is never used in a container number. Verify the photo and correct the OCR result.";

    if (/^\d{6}$/.test(code) && !VALID_NUMERIC_STARTS.has(code[0])) {
      return "A six-digit container number can only begin with 3, 7, or 8. It can never begin with 0, 1, 2, 4, 5, 6, or 9.";
    }

    if (code.length === 6 && !VALID_CONTAINER_CODE.test(code)) {
      return "This does not match a valid container format. Verify all six characters before saving.";
    }

    return "";
  };

  // Replace the OCR validator with the strict real-world container rules.
  try {
    isOcrContainerCode = code => VALID_CONTAINER_CODE.test(normalize(code));
  } catch {}

  const attachValidation = field => {
    if (!field || field.dataset.packratHardRules === "true") return;
    field.dataset.packratHardRules = "true";

    const validate = () => {
      const message = validationMessage(field.value);
      field.setCustomValidity(message);
      if (message && typeof setOcrStatus === "function" && field.id === "ocrReviewInput") {
        setOcrStatus(message.toUpperCase(), "error");
      }
      if (typeof updateOcrReviewButton === "function" && field.id === "ocrReviewInput") {
        updateOcrReviewButton();
      }
    };

    field.addEventListener("input", validate);
    field.addEventListener("change", validate);
    field.addEventListener("blur", validate);
    validate();
  };

  const attachAll = () => {
    attachValidation(document.getElementById("ocrReviewInput"));
    attachValidation(document.getElementById("containerNumber") || document.querySelector('input[maxlength="6"]'));
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", attachAll);
  else attachAll();

  new MutationObserver(attachAll).observe(document.documentElement, { childList: true, subtree: true });

  window.PACKRAT_OCR_HARD_RULES = Object.freeze({
    forbiddenLetters: Object.freeze([...FORBIDDEN_LETTERS]),
    validNumericStarts: Object.freeze([...VALID_NUMERIC_STARTS]),
    validPattern: VALID_CONTAINER_CODE,
    validationMessage
  });
})();
