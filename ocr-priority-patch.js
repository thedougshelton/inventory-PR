(() => {
  "use strict";

  const VALID_CODE = /^(?:D\d{5}|B\d{5}|C\d{5}|ZM\d{4}|[378]\d{5})$/;
  const CONFUSION_GROUPS = ["0ODQ", "1IL", "2Z", "5S", "6G", "8B", "MN"];

  const formatWeight = code => {
    if (/^D\d{5}$/.test(code)) return 130;
    if (/^ZM\d{4}$/.test(code)) return 125;
    if (/^8\d{5}$/.test(code)) return 115;
    if (/^7\d{5}$/.test(code)) return 105;
    if (/^3\d{5}$/.test(code)) return 100;
    if (/^C\d{5}$/.test(code)) return 65;
    if (/^B\d{5}$/.test(code)) return 50;
    return 0;
  };

  const uploadedCodes = () => {
    try {
      return Array.isArray(occupiedMaster && occupiedMaster.codes)
        ? occupiedMaster.codes.map(code => normalizeCode(code)).filter(code => VALID_CODE.test(code))
        : [];
    } catch {
      return [];
    }
  };

  const knownInventoryMatch = code => uploadedCodes().includes(normalizeCode(code));

  const confusionCost = (a, b) => {
    if (a === b) return 0;
    if (CONFUSION_GROUPS.some(group => group.includes(a) && group.includes(b))) return 0.25;
    if (/\d/.test(a) && /\d/.test(b)) return 1;
    return 1.4;
  };

  const codeDistance = (left, right) => {
    if (left.length !== right.length) return 99;
    let total = 0;
    for (let i = 0; i < left.length; i += 1) total += confusionCost(left[i], right[i]);
    return total;
  };

  const fuzzyInventoryMatches = rawCode => {
    const raw = normalizeCode(rawCode || "");
    if (raw.length !== 6) return [];
    return uploadedCodes()
      .map(code => ({ code, distance: codeDistance(raw, code) }))
      .filter(item => item.distance <= 1.5)
      .sort((a, b) => a.distance - b.distance || formatWeight(b.code) - formatWeight(a.code))
      .slice(0, 4);
  };

  const addCandidate = (map, code, bonus = 0, reason = "OCR") => {
    const normalized = normalizeCode(code || "");
    if (!VALID_CODE.test(normalized) || IGNORED_UPLOADED_UNIT_CODES.has(normalized)) return;
    const inventoryBonus = knownInventoryMatch(normalized) ? 1600 : 0;
    const score = formatWeight(normalized) + bonus + inventoryBonus;
    const previous = map.get(normalized);
    if (!previous || score > previous.score) map.set(normalized, { code: normalized, score, reason });
  };

  const digitPossibilities = character => {
    const map = {
      O: "0", D: "0", Q: "0", I: "1", L: "1", Z: "2", S: "5", G: "6", B: "8"
    };
    return /\d/.test(character) ? [character] : (map[character] ? [map[character]] : []);
  };

  const expandNumericTail = tail => {
    let results = [""];
    for (const character of tail) {
      const possibilities = digitPossibilities(character);
      if (!possibilities.length) return [];
      results = results.flatMap(prefix => possibilities.map(value => prefix + value)).slice(0, 24);
    }
    return results;
  };

  const priorityCandidateObjects = text => {
    const compact = normalizeUpperText(text).replace(/[^A-Z0-9]+/g, "");
    const candidates = new Map();

    for (let index = 0; index <= compact.length - 6; index += 1) {
      const raw = compact.slice(index, index + 6);
      addCandidate(candidates, raw, 50, "literal OCR read");

      expandNumericTail(raw.slice(1)).forEach(tail => {
        if (/[D0OQ]/.test(raw[0])) addCandidate(candidates, "D" + tail, raw[0] === "D" ? 65 : 35, "likely D prefix");
        if (/[8B]/.test(raw[0])) {
          addCandidate(candidates, "8" + tail, raw[0] === "8" ? 65 : 38, "8/B correction");
          addCandidate(candidates, "B" + tail, raw[0] === "B" ? 25 : 5, "rare B possibility");
        }
        if (/[CG6]/.test(raw[0])) addCandidate(candidates, "C" + tail, raw[0] === "C" ? 35 : 15, "C/G correction");
        if (/[378]/.test(raw[0])) addCandidate(candidates, raw[0] + tail, 55, "numeric container format");
      });

      expandNumericTail(raw.slice(2)).forEach(tail => {
        if (/[Z237]/.test(raw[0]) && /[MN]/.test(raw[1])) {
          addCandidate(candidates, "ZM" + tail, raw.startsWith("ZM") ? 75 : 42, "likely ZM prefix");
        }
      });

      fuzzyInventoryMatches(raw).forEach(match => {
        addCandidate(candidates, match.code, 900 - match.distance * 180, "close uploaded inventory match");
      });
    }

    return [...candidates.values()].sort((a, b) => b.score - a.score);
  };

  const loadImage = dataUrl => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not prepare OCR image."));
    image.src = dataUrl;
  });

  const canvasDataUrl = async (dataUrl, transform) => {
    const image = await loadImage(dataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    transform(imageData, canvas.width, canvas.height);
    context.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.94);
  };

  const enhancedVariants = async dataUrl => {
    const variants = [dataUrl];
    const contrast = await canvasDataUrl(dataUrl, imageData => {
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        const value = Math.max(0, Math.min(255, (gray - 128) * 1.8 + 128));
        data[i] = data[i + 1] = data[i + 2] = value;
      }
    });
    variants.push(contrast);

    for (const threshold of [105, 135, 165]) {
      variants.push(await canvasDataUrl(dataUrl, imageData => {
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
          const value = gray >= threshold ? 255 : 0;
          data[i] = data[i + 1] = data[i + 2] = value;
        }
      }));
    }
    return variants;
  };

  const autoTightCrop = async dataUrl => {
    const image = await loadImage(dataUrl);
    const source = document.createElement("canvas");
    source.width = image.naturalWidth || image.width;
    source.height = image.naturalHeight || image.height;
    const context = source.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, source.width, source.height);
    const pixels = context.getImageData(0, 0, source.width, source.height).data;
    const step = Math.max(1, Math.floor(Math.min(source.width, source.height) / 350));
    let minX = source.width, minY = source.height, maxX = 0, maxY = 0, hits = 0;

    for (let y = step; y < source.height - step; y += step) {
      for (let x = step; x < source.width - step; x += step) {
        const index = (y * source.width + x) * 4;
        const gray = pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
        const rightIndex = (y * source.width + Math.min(source.width - 1, x + step)) * 4;
        const rightGray = pixels[rightIndex] * 0.299 + pixels[rightIndex + 1] * 0.587 + pixels[rightIndex + 2] * 0.114;
        if (Math.abs(gray - rightGray) > 55) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y); hits += 1;
        }
      }
    }

    if (hits < 18 || maxX <= minX || maxY <= minY) return dataUrl;
    const padX = Math.round((maxX - minX) * 0.12);
    const padY = Math.round((maxY - minY) * 0.3);
    minX = Math.max(0, minX - padX); maxX = Math.min(source.width, maxX + padX);
    minY = Math.max(0, minY - padY); maxY = Math.min(source.height, maxY + padY);
    const width = maxX - minX, height = maxY - minY;
    if (width < source.width * 0.2 || height < source.height * 0.08) return dataUrl;

    const output = document.createElement("canvas");
    output.width = width; output.height = height;
    output.getContext("2d").drawImage(source, minX, minY, width, height, 0, 0, width, height);
    return output.toDataURL("image/jpeg", 0.95);
  };

  const ensureSuggestionUi = () => {
    let panel = document.getElementById("ocrSuggestionButtons");
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "ocrSuggestionButtons";
    panel.style.display = "grid";
    panel.style.gridTemplateColumns = "repeat(3, minmax(0, 1fr))";
    panel.style.gap = "6px";
    panel.style.marginTop = "4px";
    ocrReviewPanel.insertBefore(panel, ocrReviewPanel.querySelector(".ocr-review-row"));
    return panel;
  };

  const showSuggestions = suggestions => {
    const panel = ensureSuggestionUi();
    panel.innerHTML = "";
    suggestions.slice(0, 3).forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = (index === 0 ? "BEST: " : "OPTION: ") + item.code;
      button.style.minHeight = "42px";
      button.addEventListener("click", () => {
        ocrReviewInput.value = item.code;
        updateOcrReviewButton();
        setOcrStatus("SELECTED " + item.code + ". VERIFY ALL 6 CHARACTERS, THEN CONFIRM & SAVE.", "warning");
      });
      panel.appendChild(button);
    });
    panel.hidden = suggestions.length === 0;
  };

  isOcrContainerCode = code => VALID_CODE.test(normalizeCode(code || ""));
  ocrLiteralCandidateCodes = text => priorityCandidateObjects(text).map(item => item.code);

  scanContainerNumberFromImageData = async function scanContainerNumberFromImageDataAdvanced(originalImageData) {
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
    resetOcrReview();
    showSuggestions([]);
    setOcrStatus("AUTO-CROPPING AND CHECKING MULTIPLE IMAGE ENHANCEMENTS...", "info");
    setStatus("OCR is analyzing the photo. Nothing will save without confirmation.", "info");

    try {
      const orientations = [];
      if (ocrCropOrientation === "vertical") {
        orientations.push(await rotateImageDataUrl(originalImageData, 90));
        orientations.push(await rotateImageDataUrl(originalImageData, -90));
      } else {
        orientations.push(originalImageData);
      }

      let imageAttempts = [];
      for (const oriented of orientations) {
        const tight = await autoTightCrop(oriented);
        const bases = tight === oriented ? [oriented] : [tight, oriented];
        for (const base of bases) imageAttempts.push(...await enhancedVariants(base));
      }
      imageAttempts = [...new Set(imageAttempts)].slice(0, 10);

      const worker = await getOcrWorker();
      try {
        await worker.setParameters({
          tessedit_char_whitelist: "BCDMNQGILOPRSTZ0123456789",
          preserve_interword_spaces: "0"
        });
      } catch {}

      const totals = new Map();
      const appearances = new Map();
      const confidenceByCode = new Map();
      let lastText = "";

      for (const [attemptIndex, imageData] of imageAttempts.entries()) {
        setOcrStatus("OCR IMAGE PASS " + (attemptIndex + 1) + " OF " + imageAttempts.length + "...", "info");
        const result = await worker.recognize(imageData);
        lastText = result && result.data ? result.data.text || "" : "";
        const confidence = Number(result && result.data ? result.data.confidence : 0) || 0;
        priorityCandidateObjects(lastText).slice(0, 6).forEach((candidate, rank) => {
          const contribution = candidate.score + Math.max(0, 45 - rank * 8) + confidence * 0.4;
          totals.set(candidate.code, (totals.get(candidate.code) || 0) + contribution);
          appearances.set(candidate.code, (appearances.get(candidate.code) || 0) + 1);
          confidenceByCode.set(candidate.code, Math.max(confidenceByCode.get(candidate.code) || 0, confidence));
        });
      }

      const ranked = [...totals.entries()]
        .map(([code, score]) => ({ code, score, appearances: appearances.get(code) || 0, confidence: Math.round(confidenceByCode.get(code) || 0) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      if (!ranked.length) {
        const preview = normalizeUpperText(lastText).replace(/\s+/g, " ").trim().slice(0, 40);
        showOcrReview("", preview ? "NO RELIABLE NUMBER FOUND. OCR SAW: " + preview + ". TYPE THE 6 CHARACTERS BELOW." : "NO RELIABLE NUMBER FOUND. TYPE THE 6 CHARACTERS BELOW.", "warning");
        showSuggestions([]);
        setStatus("OCR could not produce a safe suggestion. Type it manually or try another photo.", "warning");
        return;
      }

      const best = ranked[0];
      showOcrReview(best.code, "BEST SUGGESTION: " + best.code + ". " + (knownInventoryMatch(best.code) ? "MATCHES THE UPLOADED INVENTORY. " : "") + (best.appearances > 1 ? "SUPPORTED BY MULTIPLE IMAGE PASSES. " : "SINGLE-PASS RESULT—CHECK CAREFULLY. ") + "SELECT AN OPTION OR EDIT THE NUMBER, VERIFY THE PHOTO, THEN CONFIRM & SAVE.", "warning");
      showSuggestions(ranked);
      setStatus("OCR suggestions are waiting for your verification. Nothing has been saved.", "warning");
    } catch (error) {
      resetOcrWorker();
      setOcrStatus("OCR FAILED: " + error.message, "error");
      setStatus("OCR failed. Type the container number manually or try another photo.", "error");
    } finally {
      scanContainerOcrBtn.disabled = editLocked;
      ocrScanCropBtn.disabled = editLocked;
    }
  };
})();