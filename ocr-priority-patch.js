(() => {
  "use strict";

  const formatWeight = code => {
    if (/^D\d{5}$/.test(code)) return 120;
    if (/^ZM\d{4}$/.test(code)) return 115;
    if (/^8\d{5}$/.test(code)) return 105;
    if (/^7\d{5}$/.test(code)) return 100;
    if (/^3\d{5}$/.test(code)) return 95;
    if (/^C\d{5}$/.test(code)) return 65;
    if (/^B\d{5}$/.test(code)) return 55;
    return 10;
  };

  const knownInventoryMatch = code => {
    try {
      return Boolean(occupiedMaster && Array.isArray(occupiedMaster.codes) && occupiedMaster.codes.includes(code));
    } catch {
      return false;
    }
  };

  const addCandidate = (map, code, bonus = 0) => {
    const normalized = normalizeCode(code || "");
    if (!/^[A-Z0-9]{6}$/.test(normalized)) return;
    if (IGNORED_UPLOADED_UNIT_CODES.has(normalized)) return;
    if (!/^(?:D\d{5}|B\d{5}|C\d{5}|ZM\d{4}|[378]\d{5})$/.test(normalized)) return;
    const score = formatWeight(normalized) + bonus + (knownInventoryMatch(normalized) ? 1000 : 0);
    map.set(normalized, Math.max(map.get(normalized) || 0, score));
  };

  const priorityCandidateObjects = text => {
    const normalized = normalizeUpperText(text).replace(/[^A-Z0-9]+/g, "");
    const candidateScores = new Map();

    for (let index = 0; index <= normalized.length - 6; index += 1) {
      const raw = normalized.slice(index, index + 6);
      addCandidate(candidateScores, raw, 30);

      const tail5 = raw.slice(1);
      if (/^\d{5}$/.test(tail5)) {
        if (/[D0OQ]/.test(raw[0])) addCandidate(candidateScores, "D" + tail5, raw[0] === "D" ? 45 : 25);
        if (/[8B]/.test(raw[0])) {
          addCandidate(candidateScores, "8" + tail5, raw[0] === "8" ? 45 : 25);
          addCandidate(candidateScores, "B" + tail5, raw[0] === "B" ? 25 : 5);
        }
        if (/[CG]/.test(raw[0])) addCandidate(candidateScores, "C" + tail5, raw[0] === "C" ? 30 : 10);
      }

      const tail4 = raw.slice(2);
      if (/^\d{4}$/.test(tail4) && /[MN]/.test(raw[1])) {
        if (/[Z237]/.test(raw[0])) addCandidate(candidateScores, "ZM" + tail4, raw.startsWith("ZM") ? 50 : 25);
      }
    }

    return [...candidateScores.entries()]
      .map(([code, score]) => ({ code, score }))
      .sort((a, b) => b.score - a.score);
  };

  isOcrContainerCode = code => /^(?:D\d{5}|B\d{5}|C\d{5}|ZM\d{4}|[378]\d{5})$/.test(normalizeCode(code || ""));
  ocrLiteralCandidateCodes = text => priorityCandidateObjects(text).map(item => item.code);

  scanContainerNumberFromImageData = async function scanContainerNumberFromImageDataPriority(originalImageData) {
    if (!originalImageData) return;
    if (requireUnlocked("scan a container number")) return;
    if (typeof Tesseract === "undefined" || !Tesseract.createWorker) {
      setOcrStatus("OCR did not load. Reopen the app after one successful online visit.", "error");
      setStatus("OCR did not load. Type the container number manually.", "error");
      input.focus();
      return;
    }

    scanContainerOcrBtn.disabled = true;
    ocrScanCropBtn.disabled = true;
    setOcrStatus("Reading the cropped container number using Tampa container patterns...", "info");
    setStatus("OCR is checking the cropped photo. This may take a few seconds.", "info");

    try {
      let imageAttempts;
      if (ocrCropOrientation === "vertical") {
        const rotatedRight = await rotateImageDataUrl(originalImageData, 90);
        const rotatedLeft = await rotateImageDataUrl(originalImageData, -90);
        imageAttempts = await prepareOcrImageDataUrls(rotatedRight);
        imageAttempts = imageAttempts.concat(await prepareOcrImageDataUrls(rotatedLeft));
      } else {
        imageAttempts = await prepareOcrImageDataUrls(originalImageData);
      }

      const worker = await getOcrWorker();
      const totals = new Map();
      const appearances = new Map();
      const confidenceByCode = new Map();
      let lastText = "";

      for (const [attemptIndex, imageData] of imageAttempts.entries()) {
        if (attemptIndex > 0) setOcrStatus("Checking the number again with another image detail pass...", "info");
        const result = await worker.recognize(imageData);
        lastText = result && result.data ? result.data.text || "" : "";
        const confidence = Number(result && result.data ? result.data.confidence : 0) || 0;
        const candidates = priorityCandidateObjects(lastText).slice(0, 4);

        candidates.forEach((candidate, rank) => {
          const rankBonus = Math.max(0, 30 - rank * 10);
          totals.set(candidate.code, (totals.get(candidate.code) || 0) + candidate.score + rankBonus + confidence * 0.35);
          appearances.set(candidate.code, (appearances.get(candidate.code) || 0) + 1);
          confidenceByCode.set(candidate.code, Math.max(confidenceByCode.get(candidate.code) || 0, confidence));
        });
      }

      const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
      if (!ranked.length) {
        const preview = normalizeUpperText(lastText).replace(/\s+/g, " ").trim().slice(0, 40);
        showOcrReview("", preview
          ? "No likely Tampa container number found. OCR saw: " + preview + ". Type all 6 characters from the photo below."
          : "No likely container number found. Type all 6 characters from the photo below.", "warning");
        setStatus("OCR did not find a likely container number. Type it manually or try again.", "warning");
        return;
      }

      const bestCandidate = ranked[0][0];
      const secondCandidate = ranked.length > 1 ? ranked[1][0] : "";
      const bestAppearances = appearances.get(bestCandidate) || 0;
      const confidence = Math.round(confidenceByCode.get(bestCandidate) || 0);
      const inventoryText = knownInventoryMatch(bestCandidate)
        ? " It matches the uploaded inventory list."
        : (occupiedMaster.codes.length ? " It is not on the uploaded inventory list." : "");
      const alternativeText = secondCandidate ? " Next possible read: " + secondCandidate + "." : "";
      const agreementText = bestAppearances >= 2
        ? " Multiple image passes supported this result."
        : " This is the strongest single-pass result, so verify it carefully.";

      showOcrReview(
        bestCandidate,
        "Best suggested container number: " + bestCandidate + " (OCR confidence " + confidence + "%)." + agreementText + alternativeText + inventoryText + " Verify all 6 characters, then tap Confirm & Save.",
        bestAppearances >= 2 || knownInventoryMatch(bestCandidate) ? "warning" : "warning"
      );
      setStatus("OCR suggestion is waiting for photo verification. Nothing has been entered yet.", "warning");
    } catch (error) {
      resetOcrWorker();
      setOcrStatus("OCR failed: " + error.message, "error");
      setStatus("OCR failed. Type the container number manually or try another photo.", "error");
    } finally {
      scanContainerOcrBtn.disabled = editLocked;
      ocrScanCropBtn.disabled = editLocked;
    }
  };
})();
