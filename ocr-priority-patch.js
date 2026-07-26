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

  const withTimeout = (promise, milliseconds, message) => {
    let timer = null;
    promise.catch(() => {});
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  };

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
      button.title = item.reason || "OCR suggestion";
      button.setAttribute("aria-label", item.code + ". " + (item.reason || "OCR suggestion"));
      button.style.minHeight = "42px";
      button.addEventListener("click", () => {
        ocrReviewInput.value = item.code;
        updateOcrReviewButton();
        setOcrStatus("SELECTED " + item.code + ". " + (item.reason ? item.reason + ". " : "") + "VERIFY ALL 6 CHARACTERS, THEN CONFIRM & SAVE.", "warning");
      });
      panel.appendChild(button);
    });
    panel.hidden = suggestions.length === 0;
  };

  let liveScanStream = null;
  let liveScanActive = false;
  let liveScanCapturing = false;
  let liveScanQuickMode = false;
  let liveScanDetectedBox = null;
  let liveScanDetectionTimer = null;

  const stopLiveScan = () => {
    liveScanActive = false;
    liveScanCapturing = false;
    liveScanDetectedBox = null;
    if (liveScanDetectionTimer) {
      clearInterval(liveScanDetectionTimer);
      liveScanDetectionTimer = null;
    }
    if (liveScanStream) {
      liveScanStream.getTracks().forEach(track => track.stop());
      liveScanStream = null;
    }
    const panel = document.getElementById("ocrLiveScanPanel");
    if (panel) {
      panel.hidden = true;
      panel.style.display = "none";
    }
  };

  const liveScanFallbackBox = () => ocrCropOrientation === "vertical"
    ? { x: 0.35, y: 0.08, width: 0.30, height: 0.84, inset: "8% 35%" }
    : { x: 0.08, y: 0.35, width: 0.84, height: 0.30, inset: "35% 8%" };

  const boxToInset = box => {
    const top = Math.max(0, box.y * 100);
    const right = Math.max(0, (1 - box.x - box.width) * 100);
    const bottom = Math.max(0, (1 - box.y - box.height) * 100);
    const left = Math.max(0, box.x * 100);
    return top.toFixed(1) + "% " + right.toFixed(1) + "% " + bottom.toFixed(1) + "% " + left.toFixed(1) + "%";
  };

  const liveScanActiveBox = () => liveScanDetectedBox || liveScanFallbackBox();

  const updateLiveScanGuide = () => {
    const frame = document.getElementById("ocrLiveScanFrame");
    const captureButton = document.getElementById("ocrCaptureLiveScanBtn");
    if (!frame) return;
    if (!liveScanDetectedBox) {
      frame.style.display = "none";
      if (captureButton) {
        captureButton.disabled = true;
        captureButton.textContent = liveScanActive ? "Waiting For Scan Area" : "Capture Live Scan";
      }
      return;
    }
    frame.style.display = "block";
    frame.style.inset = boxToInset(liveScanDetectedBox);
    frame.setAttribute("aria-label", "Detected scan area");
    if (captureButton) {
      captureButton.disabled = liveScanCapturing || !liveScanActive;
      captureButton.textContent = "Capture Detected Area";
    }
  };

  const liveFrameScore = canvas => {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return 0;
    const width = canvas.width;
    const height = canvas.height;
    const pixels = context.getImageData(0, 0, width, height).data;
    const step = Math.max(1, Math.floor(Math.min(width, height) / 80));
    let score = 0;
    let count = 0;

    for (let y = step; y < height - step; y += step) {
      for (let x = step; x < width - step; x += step) {
        const index = (y * width + x) * 4;
        const rightIndex = (y * width + Math.min(width - 1, x + step)) * 4;
        const downIndex = (Math.min(height - 1, y + step) * width + x) * 4;
        const gray = pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
        const rightGray = pixels[rightIndex] * 0.299 + pixels[rightIndex + 1] * 0.587 + pixels[rightIndex + 2] * 0.114;
        const downGray = pixels[downIndex] * 0.299 + pixels[downIndex + 1] * 0.587 + pixels[downIndex + 2] * 0.114;
        score += Math.abs(gray - rightGray) + Math.abs(gray - downGray);
        count += 1;
      }
    }

    return count ? score / count : 0;
  };

  const captureLiveFrame = video => {
    const sourceWidth = video.videoWidth || 1280;
    const sourceHeight = video.videoHeight || 720;
    const wrap = video.parentElement;
    const wrapRect = wrap ? wrap.getBoundingClientRect() : { width: sourceWidth, height: sourceHeight };
    const coverScale = Math.max(wrapRect.width / sourceWidth, wrapRect.height / sourceHeight);
    const visibleWidth = wrapRect.width / coverScale;
    const visibleHeight = wrapRect.height / coverScale;
    const visibleX = Math.max(0, (sourceWidth - visibleWidth) / 2);
    const visibleY = Math.max(0, (sourceHeight - visibleHeight) / 2);
    const guide = liveScanActiveBox();
    const isVertical = guide.height > guide.width;
    const padX = visibleWidth * (isVertical ? 0.08 : 0.06);
    const padY = visibleHeight * (isVertical ? 0.06 : 0.10);
    const cropX = Math.max(0, visibleX + guide.x * visibleWidth - padX);
    const cropY = Math.max(0, visibleY + guide.y * visibleHeight - padY);
    const cropRight = Math.min(sourceWidth, visibleX + (guide.x + guide.width) * visibleWidth + padX);
    const cropBottom = Math.min(sourceHeight, visibleY + (guide.y + guide.height) * visibleHeight + padY);
    const cropWidth = Math.max(1, cropRight - cropX);
    const cropHeight = Math.max(1, cropBottom - cropY);
    const maxSide = 650;
    const scale = Math.min(1, maxSide / Math.max(cropWidth, cropHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(cropWidth * scale));
    canvas.height = Math.max(1, Math.round(cropHeight * scale));
    const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    if (!context) return { dataUrl: "", score: 0 };
    context.fillStyle = "#FFFFFF";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(video, cropX, cropY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    return {
      dataUrl: canvas.toDataURL("image/jpeg", 0.94),
      score: liveFrameScore(canvas)
    };
  };

  const edgeWindowScore = (integral, stride, x, y, width, height) => {
    const x2 = x + width;
    const y2 = y + height;
    const total = integral[y2 * stride + x2] - integral[y * stride + x2] - integral[y2 * stride + x] + integral[y * stride + x];
    return total / Math.max(1, width * height);
  };

  const detectLiveTextBox = video => {
    const sourceWidth = video.videoWidth || 0;
    const sourceHeight = video.videoHeight || 0;
    if (!sourceWidth || !sourceHeight) return null;

    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    if (!context) return null;
    const wrap = video.parentElement;
    const wrapRect = wrap ? wrap.getBoundingClientRect() : { width: 4, height: 3 };
    const coverScale = Math.max(wrapRect.width / sourceWidth, wrapRect.height / sourceHeight);
    const visibleWidth = Math.max(1, wrapRect.width / coverScale);
    const visibleHeight = Math.max(1, wrapRect.height / coverScale);
    const visibleX = Math.max(0, (sourceWidth - visibleWidth) / 2);
    const visibleY = Math.max(0, (sourceHeight - visibleHeight) / 2);
    context.fillStyle = "#111827";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(video, visibleX, visibleY, visibleWidth, visibleHeight, 0, 0, canvas.width, canvas.height);

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const width = canvas.width;
    const height = canvas.height;
    const gray = new Uint8ClampedArray(width * height);
    for (let index = 0; index < pixels.length; index += 4) {
      gray[index / 4] = Math.round(pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114);
    }

    const stride = width + 1;
    const integral = new Float32Array((width + 1) * (height + 1));
    for (let y = 1; y <= height; y += 1) {
      let rowTotal = 0;
      for (let x = 1; x <= width; x += 1) {
        const center = gray[(y - 1) * width + (x - 1)];
        const right = gray[(y - 1) * width + Math.min(width - 1, x)];
        const down = gray[Math.min(height - 1, y) * width + (x - 1)];
        const edge = Math.min(255, Math.abs(center - right) + Math.abs(center - down));
        rowTotal += edge;
        integral[y * stride + x] = integral[(y - 1) * stride + x] + rowTotal;
      }
    }

    const candidates = [];
    const addCandidates = (boxWidth, boxHeight, orientation) => {
      const stepX = Math.max(8, Math.round(boxWidth / 6));
      const stepY = Math.max(8, Math.round(boxHeight / 6));
      for (let y = 0; y <= height - boxHeight; y += stepY) {
        for (let x = 0; x <= width - boxWidth; x += stepX) {
          const score = edgeWindowScore(integral, stride, x, y, boxWidth, boxHeight);
          const centerX = x + boxWidth / 2;
          const centerY = y + boxHeight / 2;
          const centerPenalty = (Math.abs(centerX - width / 2) / width + Math.abs(centerY - height / 2) / height) * 10;
          candidates.push({ x, y, width: boxWidth, height: boxHeight, orientation, score: score - centerPenalty });
        }
      }
    };

    addCandidates(Math.round(width * 0.64), Math.round(height * 0.22), "horizontal");
    addCandidates(Math.round(width * 0.78), Math.round(height * 0.26), "horizontal");
    addCandidates(Math.round(width * 0.26), Math.round(height * 0.66), "vertical");
    addCandidates(Math.round(width * 0.22), Math.round(height * 0.78), "vertical");

    const best = candidates.sort((a, b) => b.score - a.score)[0];
    if (!best || best.score < 15) return null;

    const padX = best.width * 0.10;
    const padY = best.height * 0.14;
    const x = Math.max(0, best.x - padX);
    const y = Math.max(0, best.y - padY);
    const right = Math.min(width, best.x + best.width + padX);
    const bottom = Math.min(height, best.y + best.height + padY);
    return {
      x: x / width,
      y: y / height,
      width: Math.max(0.08, (right - x) / width),
      height: Math.max(0.08, (bottom - y) / height),
      score: best.score,
      orientation: best.orientation
    };
  };

  const beginLiveScanDetection = video => {
    if (liveScanDetectionTimer) clearInterval(liveScanDetectionTimer);
    liveScanDetectionTimer = setInterval(() => {
      if (!liveScanActive || liveScanCapturing) return;
      const detected = detectLiveTextBox(video);
      liveScanDetectedBox = detected;
      if (detected) {
        ocrCropOrientation = detected.orientation === "vertical" ? "vertical" : "horizontal";
        setOcrStatus("SCAN AREA DETECTED. TAP CAPTURE DETECTED AREA WHEN THE BOX IS AROUND THE NUMBER.", "info");
      } else {
        setOcrStatus("LOOKING FOR A CONTAINER NUMBER. MOVE THE CAMERA UNTIL A GREEN BOX APPEARS.", "info");
      }
      updateLiveScanGuide();
    }, 650);
  };

  const showLiveScanCaptureForReview = async dataUrl => {
    const image = await loadImage(dataUrl);
    ocrCropState = {
      dataUrl,
      image,
      zoom: 1,
      offsetX: 0,
      offsetY: 0
    };
    ocrCropPanel.hidden = false;
    setContainerInputValue("");
    resetOcrReview();
    showSuggestions([]);
    setOcrCropOrientation(ocrCropOrientation);
    showOcrReview(
      "",
      "DETECTED AREA CAPTURED. LIVE OCR WAS NOT RUN SO THE APP DOES NOT FREEZE. COMPARE THE PHOTO, TYPE THE 6 CHARACTERS, THEN CONFIRM & SAVE.",
      "warning"
    );
    setStatus("Live Scan captured a still image for review. Nothing was saved.", "warning");
    requestAnimationFrame(renderOcrCropPreview);
  };

  const ensureLiveScanUi = () => {
    if (document.getElementById("ocrLiveScanPanel")) return;
    if (!scanContainerOcrBtn || !scanContainerOcrBtn.parentNode) return;
    scanContainerOcrBtn.textContent = "Take Container Number Photo";

    const panel = document.createElement("div");
    panel.id = "ocrLiveScanPanel";
    panel.hidden = true;
    panel.style.display = "none";
    panel.style.gap = "8px";
    panel.style.padding = "8px";
    panel.style.border = "1px solid var(--border)";
    panel.style.borderRadius = "10px";
    panel.style.background = "#ffffff";

    const videoWrap = document.createElement("div");
    videoWrap.style.position = "relative";
    videoWrap.style.width = "100%";
    videoWrap.style.aspectRatio = "4 / 3";
    videoWrap.style.overflow = "hidden";
    videoWrap.style.borderRadius = "10px";
    videoWrap.style.background = "#111827";
    videoWrap.id = "ocrLiveScanVideoWrap";

    const video = document.createElement("video");
    video.id = "ocrLiveScanVideo";
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.style.width = "100%";
    video.style.height = "100%";
    video.style.objectFit = "cover";

    const frame = document.createElement("div");
    frame.id = "ocrLiveScanFrame";
    frame.style.position = "absolute";
    frame.style.display = "none";
    frame.style.inset = boxToInset(liveScanFallbackBox());
    frame.style.border = "2px solid #22c55e";
    frame.style.borderRadius = "8px";
    frame.style.boxShadow = "0 0 0 999px rgba(15, 23, 42, 0.32)";
    frame.style.pointerEvents = "none";

    const captureButton = document.createElement("button");
    captureButton.id = "ocrCaptureLiveScanBtn";
    captureButton.type = "button";
    captureButton.className = "primary";
    captureButton.textContent = "Capture Live Scan";
    captureButton.style.minHeight = "44px";
    captureButton.addEventListener("click", captureLiveScanBurst);

    const stopButton = document.createElement("button");
    stopButton.id = "ocrStopLiveScanBtn";
    stopButton.type = "button";
    stopButton.textContent = "Stop Live Scan";
    stopButton.style.minHeight = "40px";
    stopButton.addEventListener("click", () => {
      stopLiveScan();
      setOcrStatus("LIVE SCAN STOPPED.", "warning");
    });

    videoWrap.appendChild(video);
    videoWrap.appendChild(frame);
    panel.appendChild(videoWrap);
    panel.appendChild(captureButton);
    panel.appendChild(stopButton);
    ocrStatus.insertAdjacentElement("afterend", panel);
    ocrOrientationButtons.forEach(button => button.addEventListener("click", updateLiveScanGuide));
  };

  async function startLiveScan() {
    if (requireUnlocked("start live scan")) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setOcrStatus("LIVE CAMERA IS NOT AVAILABLE IN THIS BROWSER. USE PHOTO SCAN INSTEAD.", "error");
      return;
    }
    if (liveScanActive) return;

    const panel = document.getElementById("ocrLiveScanPanel");
    const video = document.getElementById("ocrLiveScanVideo");
    if (!panel || !video) return;

    try {
      liveScanActive = true;
      liveScanCapturing = false;
      panel.hidden = false;
      panel.style.display = "grid";
      resetOcrReview();
      showSuggestions([]);
      setOcrStatus("STARTING LIVE CAMERA...", "info");
      liveScanStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      video.srcObject = liveScanStream;
      await video.play();
      updateLiveScanGuide();
      beginLiveScanDetection(video);
      setOcrStatus("LIVE CAMERA READY. THE GREEN BOX WILL APPEAR WHEN A SCAN AREA IS DETECTED.", "info");
      setStatus("Live scan camera is open. Wait for the green detected box, then capture.", "info");
    } catch (error) {
      stopLiveScan();
      setOcrStatus("LIVE SCAN FAILED: " + error.message, "error");
      setStatus("Live scan failed. Use photo scan or type manually.", "error");
    }
  }

  window.startDetectedLiveScan = null;

  async function captureLiveScanBurst() {
    if (!liveScanActive || liveScanCapturing) return;
    const video = document.getElementById("ocrLiveScanVideo");
    const captureButton = document.getElementById("ocrCaptureLiveScanBtn");
    if (!video) return;
    if (!liveScanDetectedBox) {
      setOcrStatus("NO SCAN AREA DETECTED YET. MOVE CLOSER OR CHANGE ANGLE UNTIL THE GREEN BOX APPEARS.", "warning");
      return;
    }

    try {
      liveScanCapturing = true;
      if (captureButton) captureButton.disabled = true;
      let bestFrame = { dataUrl: "", score: -1 };
      for (let index = 1; index <= 2 && liveScanActive; index += 1) {
        await new Promise(resolve => setTimeout(resolve, index === 1 ? 250 : 160));
        const frame = captureLiveFrame(video);
        if (frame.dataUrl && frame.score > bestFrame.score) bestFrame = frame;
        setOcrStatus("LIVE SCAN CAPTURED FRAME " + index + " OF 2...", "info");
      }

      const wasStopped = !liveScanActive;
      stopLiveScan();
      if (wasStopped) {
        setOcrStatus("LIVE SCAN STOPPED.", "warning");
        return;
      }
      if (!bestFrame.dataUrl) {
        setOcrStatus("LIVE SCAN COULD NOT CAPTURE A CLEAR FRAME. TRY PHOTO SCAN.", "warning");
        return;
      }

      await showLiveScanCaptureForReview(bestFrame.dataUrl);
    } catch (error) {
      stopLiveScan();
      setOcrStatus("LIVE SCAN FAILED: " + error.message, "error");
      setStatus("Live scan failed. Use photo scan or type manually.", "error");
    } finally {
      liveScanQuickMode = false;
      liveScanCapturing = false;
      if (captureButton && liveScanActive) captureButton.disabled = false;
    }
  }

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
        orientations.push({ dataUrl: await rotateImageDataUrl(originalImageData, 90), pageSegMode: "7" });
        orientations.push({ dataUrl: await rotateImageDataUrl(originalImageData, -90), pageSegMode: "7" });
        orientations.push({ dataUrl: originalImageData, pageSegMode: "6" });
        orientations.push({ dataUrl: originalImageData, pageSegMode: "11" });
      } else {
        orientations.push({ dataUrl: originalImageData, pageSegMode: "7" });
      }

      let imageAttempts = [];
      for (const oriented of orientations) {
        const tight = await autoTightCrop(oriented.dataUrl);
        const bases = tight === oriented.dataUrl ? [oriented.dataUrl] : [tight, oriented.dataUrl];
        for (const base of bases) {
          const variants = await enhancedVariants(base);
          imageAttempts.push(...variants.map(dataUrl => ({ dataUrl, pageSegMode: oriented.pageSegMode })));
        }
      }
      imageAttempts = [...new Map(imageAttempts.map(attempt => [attempt.pageSegMode + ":" + attempt.dataUrl, attempt])).values()]
        .slice(0, liveScanQuickMode ? 2 : 14);

      let worker = await getOcrWorker();
      try {
        await worker.setParameters({
          tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
          preserve_interword_spaces: "0"
        });
      } catch {}

      const totals = new Map();
      const appearances = new Map();
      const confidenceByCode = new Map();
      const reasonByCode = new Map();
      const partialReads = new Set();
      let activePageSegMode = "7";
      let lastText = "";

      for (const [attemptIndex, attempt] of imageAttempts.entries()) {
        setOcrStatus("OCR IMAGE PASS " + (attemptIndex + 1) + " OF " + imageAttempts.length + "...", "info");
        await new Promise(resolve => setTimeout(resolve, 20));
        if (attempt.pageSegMode !== activePageSegMode) {
          try {
            await worker.setParameters({ tessedit_pageseg_mode: attempt.pageSegMode });
          } catch {}
          activePageSegMode = attempt.pageSegMode;
        }
        let result = null;
        try {
          result = await withTimeout(
            worker.recognize(attempt.dataUrl),
            liveScanQuickMode ? 6500 : 22000,
            "OCR pass timed out"
          );
        } catch (error) {
          resetOcrWorker().catch(() => {});
          if (liveScanQuickMode) {
            setOcrStatus("LIVE SCAN OCR TOOK TOO LONG AND WAS STOPPED. TRY PHOTO SCAN OR TYPE THE NUMBER MANUALLY.", "warning");
            setStatus("Live scan was stopped before it could freeze. Nothing was saved.", "warning");
            break;
          }
          throw error;
        }
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
      resetOcrWorker();
      setOcrStatus("OCR FAILED: " + error.message, "error");
      setStatus("OCR failed. Type the container number manually or try another photo.", "error");
    } finally {
      scanContainerOcrBtn.disabled = editLocked;
      ocrScanCropBtn.disabled = editLocked;
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureLiveScanUi, { once: true });
  } else {
    ensureLiveScanUi();
  }
})();
