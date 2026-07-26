(() => {
  "use strict";

  const VALID_CODE = /^(?:D\d{5}|B\d{5}|C\d{5}|ZM\d{4}|TR\d{4}|PS\d{4}|[378]\d{5})$/;
  const ALLOWED_OCR_CHARACTERS = "BCDMPRSTZ0123456789";
  const DIGIT_OCR_CHARACTERS = "0123456789";
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
      if (ocrCropOrientation === "vertical" && /^\d{5}$/.test(group)) {
        addCandidate(candidates, "D" + group, 28, "vertical scan may have missed the leading D");
        if (group[0] === "3") {
          addCandidate(candidates, "D6" + group.slice(1), 58, "possible merged vertical D and 6");
        }
        if (group[0] === "1") {
          addCandidate(candidates, "70" + group.slice(1), 82, "possible merged vertical 7 and 0");
          addCandidate(candidates, "80" + group.slice(1), 65, "possible merged vertical 8 and 0");
          addCandidate(candidates, "30" + group.slice(1), 55, "possible merged vertical 3 and 0");
        }
        addCandidate(candidates, "8" + group, 16, "possible missing numeric prefix");
        addCandidate(candidates, "7" + group, 10, "possible missing numeric prefix");
        addCandidate(candidates, "3" + group, 8, "possible missing numeric prefix");
      }
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

  const foregroundTightCrop = async dataUrl => {
    const image = await loadImage(dataUrl);
    const source = document.createElement("canvas");
    source.width = image.naturalWidth || image.width;
    source.height = image.naturalHeight || image.height;
    const context = source.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, source.width, source.height);
    const pixels = context.getImageData(0, 0, source.width, source.height).data;
    const cornerPoints = [
      [2, 2],
      [source.width - 3, 2],
      [2, source.height - 3],
      [source.width - 3, source.height - 3]
    ];
    const background = cornerPoints.reduce((sum, [x, y]) => {
      const index = (Math.max(0, y) * source.width + Math.max(0, x)) * 4;
      return sum + pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
    }, 0) / cornerPoints.length;
    const step = Math.max(1, Math.floor(Math.min(source.width, source.height) / 500));
    let minX = source.width;
    let minY = source.height;
    let maxX = -1;
    let maxY = -1;
    let hits = 0;

    for (let y = 0; y < source.height; y += step) {
      for (let x = 0; x < source.width; x += step) {
        const index = (y * source.width + x) * 4;
        const gray = pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
        if (Math.abs(gray - background) < 48) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        hits += 1;
      }
    }

    if (hits < 30 || maxX <= minX || maxY <= minY) return dataUrl;
    const contentWidth = maxX - minX + 1;
    const contentHeight = maxY - minY + 1;
    if (contentWidth < source.width * 0.08 || contentHeight < source.height * 0.08) return dataUrl;
    const sourcePadX = Math.round(contentWidth * 0.05);
    const sourcePadY = Math.round(contentHeight * 0.12);
    minX = Math.max(0, minX - sourcePadX);
    minY = Math.max(0, minY - sourcePadY);
    maxX = Math.min(source.width - 1, maxX + sourcePadX);
    maxY = Math.min(source.height - 1, maxY + sourcePadY);
    const cropWidth = maxX - minX + 1;
    const cropHeight = maxY - minY + 1;
    const marginX = Math.max(16, Math.round(cropWidth * 0.08));
    const marginY = Math.max(16, Math.round(cropHeight * 0.16));
    const output = document.createElement("canvas");
    output.width = cropWidth + marginX * 2;
    output.height = cropHeight + marginY * 2;
    const outputContext = output.getContext("2d", { alpha: false });
    const backgroundValue = Math.max(0, Math.min(255, Math.round(background)));
    outputContext.fillStyle = `rgb(${backgroundValue}, ${backgroundValue}, ${backgroundValue})`;
    outputContext.fillRect(0, 0, output.width, output.height);
    outputContext.drawImage(
      source,
      minX,
      minY,
      cropWidth,
      cropHeight,
      marginX,
      marginY,
      cropWidth,
      cropHeight
    );
    return output.toDataURL("image/jpeg", 0.96);
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
  let liveOcrSessionId = 0;
  let liveOcrStream = null;
  let liveOcrVideo = null;
  let liveOcrPhotoFallback = false;
  const liveOcrControls = () => ({
    cropControls: ocrCropPanel.querySelector(".ocr-crop-controls"),
    orientationControls: ocrCropPanel.querySelector(".ocr-orientation-controls")
  });
  const ensureLiveOcrVideo = () => {
    if (liveOcrVideo) return liveOcrVideo;
    liveOcrVideo = document.createElement("video");
    liveOcrVideo.id = "ocrLiveVideo";
    liveOcrVideo.autoplay = true;
    liveOcrVideo.muted = true;
    liveOcrVideo.playsInline = true;
    liveOcrVideo.setAttribute("aria-label", "Live container number camera");
    liveOcrVideo.hidden = true;
    ocrCropCanvas.parentElement.appendChild(liveOcrVideo);
    return liveOcrVideo;
  };
  const restoreLiveOcrControls = () => {
    const { cropControls, orientationControls } = liveOcrControls();
    if (cropControls) cropControls.hidden = false;
    if (orientationControls) orientationControls.hidden = false;
    ocrCropCanvas.hidden = false;
    if (liveOcrVideo) liveOcrVideo.hidden = true;
  };
  const stopLiveOcrCamera = ({ keepPanel = false } = {}) => {
    liveOcrSessionId += 1;
    if (liveOcrStream) {
      liveOcrStream.getTracks().forEach(track => track.stop());
      liveOcrStream = null;
    }
    if (liveOcrVideo) {
      liveOcrVideo.pause();
      liveOcrVideo.srcObject = null;
    }
    restoreLiveOcrControls();
    if (!keepPanel && !ocrCropState) ocrCropPanel.hidden = true;
    scanContainerOcrBtn.disabled = editLocked;
  };
  const waitForLiveVideo = video => new Promise((resolve, reject) => {
    if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("The camera did not become ready."));
    }, 8000);
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("error", onError);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("The camera video could not be opened."));
    };
    video.addEventListener("loadeddata", onReady, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
  const captureLiveOcrFrame = async (video, rotation = 0) => {
    const sourceWidth = video.videoWidth || 1280;
    const sourceHeight = video.videoHeight || 720;
    const scale = Math.min(1, 720 / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#FFFFFF";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.86);
    return rotation ? rotateImageDataUrl(dataUrl, rotation) : dataUrl;
  };
  const freezeLiveOcrFrame = async dataUrl => {
    const image = await loadImageFromDataUrl(dataUrl);
    ocrCropState = {
      dataUrl,
      image,
      zoom: 1,
      offsetX: 0,
      offsetY: 0
    };
    stopLiveOcrCamera({ keepPanel: true });
    scanContainerOcrBtn.disabled = true;
    ocrCropPanel.hidden = false;
    resetOcrReview();
    requestAnimationFrame(renderOcrCropPreview);
  };
  const rankLiveVotes = votes => [...votes.values()]
    .sort((left, right) => right.count - left.count || right.score - left.score)
    .slice(0, 3);
  const liveCandidateObjects = text => {
    const candidates = new Map(
      priorityCandidateObjects(text).map(candidate => [candidate.code, candidate])
    );
    rawTextGroups(text).forEach(group => {
      if (!/^\d{5}$/.test(group)) return;
      addCandidate(candidates, "D" + group, 28, "live scan may have missed the leading D");
      if (group[0] === "3") {
        addCandidate(candidates, "D6" + group.slice(1), 58, "possible merged live D and 6");
      }
      if (group[0] === "1") {
        addCandidate(candidates, "70" + group.slice(1), 82, "possible merged live 7 and 0");
        addCandidate(candidates, "80" + group.slice(1), 65, "possible merged live 8 and 0");
        addCandidate(candidates, "30" + group.slice(1), 55, "possible merged live 3 and 0");
      }
      addCandidate(candidates, "8" + group, 16, "possible missing numeric prefix");
      addCandidate(candidates, "7" + group, 10, "possible missing numeric prefix");
      addCandidate(candidates, "3" + group, 8, "possible missing numeric prefix");
    });
    return [...candidates.values()].sort((left, right) => right.score - left.score);
  };
  const recordLiveCandidates = (votes, text, confidence) => {
    liveCandidateObjects(text).slice(0, 3).forEach((candidate, rank) => {
      const previous = votes.get(candidate.code) || {
        code: candidate.code,
        count: 0,
        score: 0,
        confidence: 0,
        reason: candidate.reason || "real-time OCR"
      };
      previous.count += 1;
      previous.score += candidate.score + Math.max(0, 30 - rank * 8) + confidence * 0.25;
      previous.confidence = Math.max(previous.confidence, Math.round(confidence));
      if (candidate.reason) previous.reason = candidate.reason;
      votes.set(candidate.code, previous);
    });
  };
  const runLiveOcrSession = async (sessionId, video) => {
    const votes = new Map();
    let lastUnrotatedFrame = "";
    const rotations = [0, 90, -90, 0, 90, -90];
    const whitelists = [
      DIGIT_OCR_CHARACTERS,
      ALLOWED_OCR_CHARACTERS,
      DIGIT_OCR_CHARACTERS,
      ALLOWED_OCR_CHARACTERS,
      DIGIT_OCR_CHARACTERS,
      ALLOWED_OCR_CHARACTERS
    ];
    const worker = await withOcrTimeout(
      getOcrWorker(),
      20000,
      "REAL-TIME OCR COULD NOT START. USE THE PHOTO SCANNER."
    );

    for (let pass = 0; pass < rotations.length; pass += 1) {
      if (sessionId !== liveOcrSessionId || !liveOcrStream) return;
      setOcrStatus("REAL-TIME OCR PASS " + (pass + 1) + " OF " + rotations.length + ". HOLD THE NUMBER STEADY.", "info");
      lastUnrotatedFrame = await captureLiveOcrFrame(video, 0);
      const frame = rotations[pass]
        ? await rotateImageDataUrl(lastUnrotatedFrame, rotations[pass])
        : lastUnrotatedFrame;
      const focused = await foregroundTightCrop(frame);
      if (sessionId !== liveOcrSessionId || !liveOcrStream) return;
      await worker.setParameters({
        tessedit_pageseg_mode: whitelists[pass] === DIGIT_OCR_CHARACTERS ? "7" : "8",
        tessedit_char_whitelist: whitelists[pass],
        preserve_interword_spaces: "0"
      });
      const result = await withOcrTimeout(
        worker.recognize(focused),
        7000,
        "A REAL-TIME OCR PASS TIMED OUT."
      );
      if (sessionId !== liveOcrSessionId || !liveOcrStream) return;
      const text = result && result.data ? result.data.text || "" : "";
      const confidence = Number(result && result.data ? result.data.confidence : 0) || 0;
      recordLiveCandidates(votes, text, confidence);
      const ranked = rankLiveVotes(votes);
      if (ranked[0] && ranked[0].count >= 2) {
        await freezeLiveOcrFrame(lastUnrotatedFrame);
        showOcrReview(
          ranked[0].code,
          "REAL-TIME OCR REPEATEDLY DETECTED " + ranked[0].code + ". VERIFY ALL 6 CHARACTERS, THEN CONFIRM & SAVE.",
          "warning"
        );
        showSuggestions(ranked);
        setStatus("Real-time OCR found a repeated result. Nothing has been saved.", "warning");
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 450));
    }

    if (sessionId !== liveOcrSessionId || !liveOcrStream) return;
    await freezeLiveOcrFrame(lastUnrotatedFrame);
    const ranked = rankLiveVotes(votes);
    showSuggestions(ranked);
    setOcrStatus(
      ranked.length
        ? "NO REPEATED RESULT. SELECT A POSSIBLE MATCH OR USE SCAN CROPPED PHOTO."
        : "NO STABLE REAL-TIME RESULT. ADJUST THE FRAME, THEN USE SCAN CROPPED PHOTO.",
      "warning"
    );
    setStatus("Real-time OCR stopped safely. Nothing has been saved.", "warning");
  };

  const cancelledScanError = () => {
    const error = new Error("OCR scan canceled.");
    error.name = "AbortError";
    return error;
  };
  const confirmActiveScan = scanId => {
    if (scanId !== activeScanId) throw cancelledScanError();
  };

  window.cancelContainerOcrScan = async function cancelContainerOcrScan(options = {}) {
    const wasRunning = scanRunning;
    stopLiveOcrCamera({ keepPanel: Boolean(options.keepPanel) });
    activeScanId += 1;
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

  window.startCombinedContainerOcr = async function startCombinedContainerOcr() {
    if (requireUnlocked("scan a container number")) return;
    if (liveOcrPhotoFallback) {
      liveOcrPhotoFallback = false;
      ocrPhotoInput.click();
      return;
    }
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      ocrPhotoInput.click();
      return;
    }

    await window.cancelContainerOcrScan({ quiet: true });
    resetOcrCrop();
    const video = ensureLiveOcrVideo();
    const { cropControls, orientationControls } = liveOcrControls();
    ocrCropPanel.hidden = false;
    ocrCropCanvas.hidden = true;
    video.hidden = false;
    if (cropControls) cropControls.hidden = true;
    if (orientationControls) orientationControls.hidden = true;
    scanContainerOcrBtn.disabled = true;
    setOcrStatus("OPENING THE CAMERA FOR REAL-TIME DIGIT AND CONTAINER OCR...", "info");
    setStatus("Real-time OCR is starting. Nothing will save without confirmation.", "info");

    const sessionId = ++liveOcrSessionId;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
      if (sessionId !== liveOcrSessionId) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      liveOcrStream = stream;
      video.srcObject = stream;
      await video.play();
      await waitForLiveVideo(video);
      if (sessionId !== liveOcrSessionId || !liveOcrStream) return;
      scanRunning = true;
      ocrProgressEnabled = true;
      await runLiveOcrSession(sessionId, video);
    } catch (error) {
      if (sessionId !== liveOcrSessionId) return;
      stopLiveOcrCamera();
      await resetOcrWorker();
      liveOcrPhotoFallback = true;
      setOcrStatus("REAL-TIME CAMERA WAS NOT AVAILABLE. TAP THE SAME SCAN BUTTON AGAIN TO USE THE PHOTO SCANNER.", "warning");
      setStatus("Camera unavailable. Nothing was saved.", "warning");
    } finally {
      scanRunning = false;
      ocrProgressEnabled = false;
    }
  };

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && liveOcrStream) {
      window.cancelContainerOcrScan({ quiet: true });
    }
  });
  window.addEventListener("pagehide", () => {
    if (liveOcrStream) window.cancelContainerOcrScan({ quiet: true });
  });

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
        const [clockwiseFocused, counterclockwiseFocused] = await Promise.all([
          foregroundTightCrop(clockwise),
          foregroundTightCrop(counterclockwise)
        ]);
        confirmActiveScan(scanId);
        const [clockwiseVariants, counterclockwiseVariants] = await Promise.all([
          enhancedVariants(clockwiseFocused),
          enhancedVariants(counterclockwiseFocused)
        ]);
        confirmActiveScan(scanId);
        // Vertical labels can read in either direction. The focused crop keeps
        // edge characters, then word, line, and raw-line modes vote together.
        attemptGroups.push([
          { dataUrl: clockwiseVariants[0], pageSegMode: "8", whitelist: ALLOWED_OCR_CHARACTERS },
          { dataUrl: clockwiseVariants[1], pageSegMode: "7", whitelist: DIGIT_OCR_CHARACTERS },
          { dataUrl: clockwiseVariants[2], pageSegMode: "13", whitelist: ALLOWED_OCR_CHARACTERS }
        ]);
        attemptGroups.push([
          { dataUrl: counterclockwiseVariants[0], pageSegMode: "8", whitelist: ALLOWED_OCR_CHARACTERS },
          { dataUrl: counterclockwiseVariants[1], pageSegMode: "7", whitelist: DIGIT_OCR_CHARACTERS },
          { dataUrl: counterclockwiseVariants[2], pageSegMode: "13", whitelist: ALLOWED_OCR_CHARACTERS }
        ]);
      } else {
        const tight = await autoTightCrop(originalImageData);
        confirmActiveScan(scanId);
        const bases = tight === originalImageData ? [originalImageData] : [tight, originalImageData];
        const orientationAttempts = [];
        for (const base of bases) {
          const variants = await enhancedVariants(base);
          confirmActiveScan(scanId);
          orientationAttempts.push(...variants.slice(0, bases.length > 1 ? 2 : 3).map((dataUrl, variantIndex) => ({
            dataUrl,
            pageSegMode: "7",
            whitelist: variantIndex === 1 ? DIGIT_OCR_CHARACTERS : ALLOWED_OCR_CHARACTERS
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
          tessedit_char_whitelist: ALLOWED_OCR_CHARACTERS,
          preserve_interword_spaces: "0"
        });
      } catch {}
      confirmActiveScan(scanId);

      const totals = new Map();
      const appearances = new Map();
      const confidenceByCode = new Map();
      const reasonByCode = new Map();
      const partialReads = new Set();
      let activePageSegMode = "";
      let activeWhitelist = "";
      let lastText = "";

      for (const [attemptIndex, attempt] of imageAttempts.entries()) {
        confirmActiveScan(scanId);
        setOcrStatus("OCR IMAGE PASS " + (attemptIndex + 1) + " OF " + imageAttempts.length + "...", "info");
        if (attempt.pageSegMode !== activePageSegMode || attempt.whitelist !== activeWhitelist) {
          try {
            await worker.setParameters({
              tessedit_pageseg_mode: attempt.pageSegMode,
              tessedit_char_whitelist: attempt.whitelist
            });
          } catch {}
          confirmActiveScan(scanId);
          activePageSegMode = attempt.pageSegMode;
          activeWhitelist = attempt.whitelist;
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
