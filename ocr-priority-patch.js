(() => {
  "use strict";

  const VALID_CODE = /^(?:D\d{5}|B\d{5}|C\d{5}|ZM\d{4}|TR\d{4}|PS\d{4}|[378]\d{5})$/;
  const CONFUSION_GROUPS = ["0ODQUVY", "1ILJ", "2Z", "5S", "6GC", "8BAX", "MNHW", "EFPRK"];
  const PREFIX_SHAPE_MAP = {
    A: ["8", "D"],
    E: ["B"],
    F: ["P"],
    G: ["C", "6"],
    H: ["M", "D"],
    I: ["1", "D"],
    J: ["1"],
    K: ["R"],
    L: ["1"],
    N: ["M", "Z"],
    O: ["0", "D"],
    Q: ["0", "D"],
    U: ["D"],
    V: ["D"],
    W: ["M"],
    X: ["8", "D"],
    Y: ["D"]
  };

  const formatWeight = code => {
    if (/^D\d{5}$/.test(code)) return 130;
    if (/^ZM\d{4}$/.test(code)) return 125;
    if (/^8\d{5}$/.test(code)) return 115;
    if (/^7\d{5}$/.test(code)) return 105;
    if (/^3\d{5}$/.test(code)) return 100;
    if (/^C\d{5}$/.test(code)) return 65;
    if (/^B\d{5}$/.test(code)) return 50;
    if (/^(TR|PS)\d{4}$/.test(code)) return 35;
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
      O: "0", D: "0", Q: "0", U: "0",
      I: "1", J: "1", L: "1",
      Z: "2",
      S: "5",
      G: "6",
      B: "8", A: "8", X: "8"
    };
    return /\d/.test(character) ? [character] : (map[character] ? [map[character]] : []);
  };

  const shapeAlternatives = character => PREFIX_SHAPE_MAP[character] || [];

  const matchesAny = (character, choices) => choices.includes(character) || shapeAlternatives(character).some(value => choices.includes(value));

  const rawTextGroups = text => {
    const normalized = normalizeUpperText(text);
    const groups = normalized
      .split(/[^A-Z0-9?]+/)
      .map(group => group.trim())
      .filter(group => group.length >= 4 && group.length <= 8);
    const compact = normalized.replace(/[^A-Z0-9?]+/g, "");
    if (compact.length >= 4 && compact.length <= 8) groups.push(compact);
    return [...new Set(groups)];
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

  const characterMatch = (seen, expected) => {
    if (!seen || seen === "?") return { score: 0, visible: false };
    if (seen === expected) return { score: 2.5, visible: true, exact: true };
    if (digitPossibilities(seen).includes(expected)) return { score: 1.8, visible: true };
    if (shapeAlternatives(seen).includes(expected)) return { score: 1.5, visible: true };
    if (confusionCost(seen, expected) <= 0.25) return { score: 1.2, visible: true };
    return { score: -2.5, visible: true };
  };

  const partialInventoryMatches = rawValue => {
    const raw = normalizeUpperText(rawValue).replace(/[^A-Z0-9?]+/g, "");
    if (raw.length < 4 || raw.length > 6) return [];

    const patterns = new Set();
    if (raw.length === 6) {
      patterns.add(raw);
    } else {
      for (let index = 0; index <= 6 - raw.length; index += 1) {
        patterns.add("?".repeat(index) + raw + "?".repeat(6 - raw.length - index));
      }
    }

    const matches = new Map();
    for (const pattern of patterns) {
      uploadedCodes().forEach(code => {
        let score = 0;
        let visible = 0;
        let strong = 0;
        let bad = 0;

        for (let index = 0; index < 6; index += 1) {
          const match = characterMatch(pattern[index], code[index]);
          score += match.score;
          if (match.visible) visible += 1;
          if (match.exact || match.score >= 1.5) strong += 1;
          if (match.score < 0) bad += 1;
        }

        if (visible < 4 || strong < 4 || bad > 0) return;
        const finalScore = 1000 + score * 80 + visible * 35 + strong * 45 + formatWeight(code);
        const previous = matches.get(code);
        if (!previous || finalScore > previous.bonus) {
          matches.set(code, {
            code,
            bonus: finalScore,
            reason: visible < 6
              ? "partial uploaded inventory match: " + pattern
              : "damaged-character uploaded inventory match"
          });
        }
      });
    }

    return [...matches.values()]
      .sort((a, b) => b.bonus - a.bonus)
      .slice(0, 5);
  };

  const priorityCandidateObjects = text => {
    const compact = normalizeUpperText(text).replace(/[^A-Z0-9]+/g, "");
    const candidates = new Map();
    rawTextGroups(text).forEach(group => {
      partialInventoryMatches(group).forEach(match => {
        addCandidate(candidates, match.code, match.bonus, match.reason);
      });
    });

    for (let index = 0; index <= compact.length - 6; index += 1) {
      const raw = compact.slice(index, index + 6);
      addCandidate(candidates, raw, 50, "literal OCR read");

      expandNumericTail(raw.slice(1)).forEach(tail => {
        if (matchesAny(raw[0], ["D", "0"])) addCandidate(candidates, "D" + tail, raw[0] === "D" ? 65 : 35, "likely D prefix");
        if (matchesAny(raw[0], ["8", "B"])) {
          addCandidate(candidates, "8" + tail, raw[0] === "8" ? 65 : 38, "8/B correction");
          addCandidate(candidates, "B" + tail, raw[0] === "B" ? 25 : 5, "rare B possibility");
        }
        if (matchesAny(raw[0], ["C", "6"])) addCandidate(candidates, "C" + tail, raw[0] === "C" ? 35 : 15, "C/G correction");
        if (/[378]/.test(raw[0])) addCandidate(candidates, raw[0] + tail, 55, "numeric container format");
      });

      expandNumericTail(raw.slice(2)).forEach(tail => {
        if (matchesAny(raw[0], ["Z", "2", "3", "7"]) && matchesAny(raw[1], ["M", "N"])) {
          addCandidate(candidates, "ZM" + tail, raw.startsWith("ZM") ? 75 : 42, "likely ZM prefix");
        }
        if (raw.startsWith("TR")) addCandidate(candidates, "TR" + tail, 18, "unusual TR prefix");
        if (raw[0] === "P" && matchesAny(raw[1], ["S", "5"])) addCandidate(candidates, "PS" + tail, raw.startsWith("PS") ? 18 : 8, "unusual PS prefix");
      });

      fuzzyInventoryMatches(raw).forEach(match => {
        addCandidate(candidates, match.code, 900 - match.distance * 180, "close uploaded inventory match");
      });
    }

    return [...candidates.values()].sort((a, b) => b.score - a.score);
  };

  const previewCandidateTexts = text => {
    return rawTextGroups(text).slice(0, 4);
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
    const imageWidth = image.naturalWidth || image.width;
    const imageHeight = image.naturalHeight || image.height;
    const scale = Math.min(1, 1600 / Math.max(imageWidth, imageHeight));
    canvas.width = Math.max(1, Math.round(imageWidth * scale));
    canvas.height = Math.max(1, Math.round(imageHeight * scale));
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

    variants.push(await canvasDataUrl(dataUrl, imageData => {
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        const value = gray >= 135 ? 255 : 0;
        data[i] = data[i + 1] = data[i + 2] = value;
      }
    }));
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
    panel.style.display = "flex";
    panel.style.gap = "6px";
    panel.style.margin = "4px 0 0";
    panel.style.padding = "0 0 2px";
    panel.style.overflowX = "auto";
    panel.style.overflowY = "hidden";
    panel.style.maxWidth = "100%";
    ocrReviewPanel.insertBefore(panel, ocrReviewPanel.querySelector(".ocr-review-row"));
    return panel;
  };

  const showSuggestions = suggestions => {
    const panel = ensureSuggestionUi();
    panel.innerHTML = "";
    suggestions.slice(0, 3).forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = (index === 0 ? "BEST: " : "") + item.code;
      button.title = item.reason || "OCR suggestion";
      button.setAttribute("aria-label", item.code + ". " + (item.reason || "OCR suggestion"));
      button.style.flex = "0 0 auto";
      button.style.width = "auto";
      button.style.minWidth = index === 0 ? "104px" : "82px";
      button.style.maxWidth = "145px";
      button.style.height = "34px";
      button.style.minHeight = "34px";
      button.style.padding = "5px 9px";
      button.style.fontSize = "0.82rem";
      button.style.lineHeight = "1";
      button.style.whiteSpace = "nowrap";
      button.addEventListener("click", () => {
        ocrReviewInput.value = item.code;
        updateOcrReviewButton();
        setOcrStatus("SELECTED " + item.code + ". " + (item.reason ? item.reason + ". " : "") + "VERIFY ALL 6 CHARACTERS, THEN CONFIRM & SAVE.", "warning");
      });
      panel.appendChild(button);
    });
    panel.hidden = suggestions.length === 0;
  };

  isOcrContainerCode = code => VALID_CODE.test(normalizeCode(code || ""));
  ocrLiteralCandidateCodes = text => priorityCandidateObjects(text).map(item => item.code);

  let activeScanId = 0;
  let scanRunning = false;
  const cancelledScanError = () => {
    const error = new Error("OCR scan canceled.");
    error.name = "AbortError";
    return error;
  };
  const confirmActiveScan = scanId => {
    if (scanId !== activeScanId) throw cancelledScanError();
  };

  window.cancelContainerOcrScan = async function cancelContainerOcrScan(options = {}) {
    activeScanId += 1;
    const wasRunning = scanRunning;
    scanRunning = false;
    ocrProgressEnabled = false;
    if (wasRunning) await resetOcrWorker();
    scanContainerOcrBtn.disabled = editLocked;
    ocrScanCropBtn.disabled = editLocked;
    if (!options.quiet && wasRunning) {
      setOcrStatus("OCR scan canceled. Take another photo or type manually.", "warning");
      setStatus("OCR scan canceled. Nothing was saved.", "warning");
    }
  };

  scanContainerNumberFromImageData = async function scanContainerNumberFromImageDataAdvanced(originalImageData) {
    if (!originalImageData) return;
    if (requireUnlocked("scan a container number")) return;
    if (typeof Tesseract === "undefined" || !Tesseract.createWorker) {
      setOcrStatus("OCR did not load. Reopen the app after one successful online visit.", "error");
      setStatus("OCR did not load. Type the container number manually.", "error");
      input.focus();
      return;
    }

    const scanId = ++activeScanId;
    scanRunning = true;
    ocrProgressEnabled = true;
    scanContainerOcrBtn.disabled = true;
    ocrScanCropBtn.disabled = true;
    resetOcrReview();
    showSuggestions([]);
    setOcrStatus("AUTO-CROPPING AND CHECKING MULTIPLE IMAGE ENHANCEMENTS...", "info");
    setStatus("OCR is analyzing the photo. Nothing will save without confirmation.", "info");

    try {
      const attemptGroups = [];
      if (ocrCropOrientation === "vertical") {
        const clockwise = await rotateImageDataUrl(originalImageData, 90);
        confirmActiveScan(scanId);
        const counterclockwise = await rotateImageDataUrl(originalImageData, -90);
        confirmActiveScan(scanId);
        const [clockwiseVariants, counterclockwiseVariants, stackedVariants] = await Promise.all([
          enhancedVariants(clockwise),
          enhancedVariants(counterclockwise),
          enhancedVariants(originalImageData)
        ]);
        confirmActiveScan(scanId);
        // Vertical labels can read in either direction. PSM 8 treats the
        // rotated code as one word, while PSM 7 handles a normal line.
        // PSM 6 also covers labels whose characters are individually stacked.
        attemptGroups.push([
          { dataUrl: clockwiseVariants[0], pageSegMode: "8" },
          { dataUrl: clockwiseVariants[1], pageSegMode: "7" },
          { dataUrl: stackedVariants[0], pageSegMode: "6" }
        ]);
        attemptGroups.push([
          { dataUrl: counterclockwiseVariants[0], pageSegMode: "8" },
          { dataUrl: counterclockwiseVariants[1], pageSegMode: "7" },
          { dataUrl: stackedVariants[2], pageSegMode: "6" }
        ]);
      } else {
        const tight = await autoTightCrop(originalImageData);
        confirmActiveScan(scanId);
        const bases = tight === originalImageData ? [originalImageData] : [tight, originalImageData];
        const orientationAttempts = [];
        for (const base of bases) {
          const variants = await enhancedVariants(base);
          confirmActiveScan(scanId);
          orientationAttempts.push(...variants.slice(0, bases.length > 1 ? 2 : 3).map(dataUrl => ({
            dataUrl,
            pageSegMode: "7"
          })));
        }
        attemptGroups.push(orientationAttempts);
      }
      let imageAttempts = [];
      const longestGroup = Math.max(0, ...attemptGroups.map(group => group.length));
      for (let index = 0; index < longestGroup; index += 1) {
        attemptGroups.forEach(group => {
          if (group[index]) imageAttempts.push(group[index]);
        });
      }
      imageAttempts = [...new Map(imageAttempts.map(attempt => [attempt.pageSegMode + ":" + attempt.dataUrl, attempt])).values()].slice(0, 6);

      const worker = await withOcrTimeout(getOcrWorker(), 20000, "OCR STARTUP TIMED OUT. TRY AGAIN OR TYPE THE NUMBER MANUALLY.");
      confirmActiveScan(scanId);
      try {
        await worker.setParameters({
          tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
          preserve_interword_spaces: "0"
        });
      } catch {}
      confirmActiveScan(scanId);

      const totals = new Map();
      const appearances = new Map();
      const confidenceByCode = new Map();
      const reasonByCode = new Map();
      const partialReads = new Set();
      let activePageSegMode = "7";
      let lastText = "";

      for (const [attemptIndex, attempt] of imageAttempts.entries()) {
        confirmActiveScan(scanId);
        setOcrStatus("OCR IMAGE PASS " + (attemptIndex + 1) + " OF " + imageAttempts.length + "...", "info");
        if (attempt.pageSegMode !== activePageSegMode) {
          try {
            await worker.setParameters({ tessedit_pageseg_mode: attempt.pageSegMode });
          } catch {}
          confirmActiveScan(scanId);
          activePageSegMode = attempt.pageSegMode;
        }
        const result = await withOcrTimeout(
          worker.recognize(attempt.dataUrl),
          10000,
          "OCR IMAGE PASS TIMED OUT. TRY AGAIN OR TYPE THE NUMBER MANUALLY."
        );
        confirmActiveScan(scanId);
        lastText = result && result.data ? result.data.text || "" : "";
        previewCandidateTexts(lastText).forEach(read => partialReads.add(read));
        const confidence = Number(result && result.data ? result.data.confidence : 0) || 0;
        priorityCandidateObjects(lastText).slice(0, 6).forEach((candidate, rank) => {
          const contribution = candidate.score + Math.max(0, 45 - rank * 8) + confidence * 0.4;
          totals.set(candidate.code, (totals.get(candidate.code) || 0) + contribution);
          appearances.set(candidate.code, (appearances.get(candidate.code) || 0) + 1);
          confidenceByCode.set(candidate.code, Math.max(confidenceByCode.get(candidate.code) || 0, confidence));
          if (candidate.reason) {
            const reasons = reasonByCode.get(candidate.code) || new Set();
            reasons.add(candidate.reason);
            reasonByCode.set(candidate.code, reasons);
          }
        });
      }

      const ranked = [...totals.entries()]
        .map(([code, score]) => ({
          code,
          score,
          appearances: appearances.get(code) || 0,
          confidence: Math.round(confidenceByCode.get(code) || 0),
          reason: [...(reasonByCode.get(code) || [])].slice(0, 2).join("; ")
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      confirmActiveScan(scanId);

      if (!ranked.length) {
        const fiveCharacterRead = [...partialReads].find(read => read.length === 5);
        const preview = normalizeUpperText(lastText).replace(/\s+/g, " ").trim().slice(0, 40);
        showOcrReview(
          "",
          fiveCharacterRead
            ? "OCR ONLY SAW 5 CHARACTERS: " + fiveCharacterRead + ". NOTHING WAS ENTERED. KEEP ALL 6 CHARACTERS INSIDE THE GREEN BOX, THEN TRY AGAIN OR TYPE ALL 6 BELOW."
            : preview
            ? "NO RELIABLE NUMBER FOUND. OCR SAW: " + preview + ". TYPE THE 6 CHARACTERS BELOW."
            : "NO RELIABLE NUMBER FOUND. TYPE THE 6 CHARACTERS BELOW.",
          "warning"
        );
        showSuggestions([]);
        setStatus("OCR could not produce a safe suggestion. Type it manually or try another photo.", "warning");
        return;
      }

      const best = ranked[0];
      showOcrReview(best.code, "BEST SUGGESTION: " + best.code + ". " + (best.reason ? best.reason.toUpperCase() + ". " : "") + (knownInventoryMatch(best.code) ? "MATCHES THE UPLOADED INVENTORY. " : "") + (best.appearances > 1 ? "SUPPORTED BY MULTIPLE IMAGE PASSES. " : "SINGLE-PASS RESULT - CHECK CAREFULLY. ") + "SELECT AN OPTION OR EDIT THE NUMBER, VERIFY THE PHOTO, THEN CONFIRM & SAVE.", "warning");
      showSuggestions(ranked);
      setStatus("OCR suggestions are waiting for your verification. Nothing has been saved.", "warning");
    } catch (error) {
      const wasCancelled = error && error.name === "AbortError";
      if (!wasCancelled && scanId === activeScanId) {
        await resetOcrWorker();
      }
      if (wasCancelled || scanId !== activeScanId) return;
      setOcrStatus("OCR FAILED: " + error.message, "error");
      setStatus("OCR failed. Type the container number manually or try another photo.", "error");
    } finally {
      if (scanId === activeScanId) {
        scanRunning = false;
        ocrProgressEnabled = false;
        scanContainerOcrBtn.disabled = editLocked;
        ocrScanCropBtn.disabled = editLocked;
      }
    }
  };
})();
