(() => {
  "use strict";

  const VALID_CODE = /^(?:D\d{5}|B\d{5}|C\d{5}|ZM\d{4}|TR\d{4}|PS\d{4}|[378]\d{5})$/;
  const ALLOWED_OCR_CHARACTERS = "BCDMPRSTZ0123456789";
  const DIGIT_OCR_CHARACTERS = "0123456789";
  const CONFUSION_GROUPS = ["0ODQUVY", "1ILJ", "2Z", "5S", "6GC", "8BAX", "38", "08", "17", "56", "MNHW", "EFPRK"];
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
      .filter(group => group.length >= 3 && group.length <= 8);
    const compact = normalized.replace(/[^A-Z0-9?]+/g, "");
    if (compact.length >= 3 && compact.length <= 8) groups.push(compact);
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
    if (raw.length < 3 || raw.length > 6) return [];

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

        const minimumStrongCharacters = raw.length >= 4 ? 4 : 3;
        if (visible < minimumStrongCharacters || strong < minimumStrongCharacters || bad > 0) return;
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

  const grayscaleHistogram = imageData => {
    const histogram = new Uint32Array(256);
    const data = imageData.data;
    for (let index = 0; index < data.length; index += 4) {
      const gray = Math.round(data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114);
      histogram[gray] += 1;
    }
    return histogram;
  };

  const histogramPercentile = (histogram, fraction) => {
    const total = histogram.reduce((sum, value) => sum + value, 0);
    const target = total * fraction;
    let running = 0;
    for (let value = 0; value < histogram.length; value += 1) {
      running += histogram[value];
      if (running >= target) return value;
    }
    return 255;
  };

  const otsuThreshold = histogram => {
    const total = histogram.reduce((sum, value) => sum + value, 0);
    let totalIntensity = 0;
    for (let value = 0; value < 256; value += 1) totalIntensity += value * histogram[value];
    let backgroundWeight = 0;
    let backgroundIntensity = 0;
    let bestVariance = -1;
    let threshold = 128;
    for (let value = 0; value < 256; value += 1) {
      backgroundWeight += histogram[value];
      if (!backgroundWeight) continue;
      const foregroundWeight = total - backgroundWeight;
      if (!foregroundWeight) break;
      backgroundIntensity += value * histogram[value];
      const backgroundMean = backgroundIntensity / backgroundWeight;
      const foregroundMean = (totalIntensity - backgroundIntensity) / foregroundWeight;
      const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
      if (variance > bestVariance) {
        bestVariance = variance;
        threshold = value;
      }
    }
    return threshold;
  };

  const localAdaptiveVariant = dataUrl => canvasDataUrl(dataUrl, (imageData, width, height) => {
    const data = imageData.data;
    const grayValues = new Uint8Array(width * height);
    const integralWidth = width + 1;
    const integral = new Uint32Array(integralWidth * (height + 1));
    for (let y = 0; y < height; y += 1) {
      let rowTotal = 0;
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x;
        const index = pixel * 4;
        const gray = Math.round(data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114);
        grayValues[pixel] = gray;
        rowTotal += gray;
        integral[(y + 1) * integralWidth + x + 1] = integral[y * integralWidth + x + 1] + rowTotal;
      }
    }
    const radius = Math.max(8, Math.round(Math.min(width, height) / 34));
    for (let y = 0; y < height; y += 1) {
      const top = Math.max(0, y - radius);
      const bottom = Math.min(height - 1, y + radius);
      for (let x = 0; x < width; x += 1) {
        const left = Math.max(0, x - radius);
        const right = Math.min(width - 1, x + radius);
        const area = (right - left + 1) * (bottom - top + 1);
        const sum = integral[(bottom + 1) * integralWidth + right + 1]
          - integral[top * integralWidth + right + 1]
          - integral[(bottom + 1) * integralWidth + left]
          + integral[top * integralWidth + left];
        const localMean = sum / area;
        const value = grayValues[y * width + x] < localMean - 9 ? 0 : 255;
        const index = (y * width + x) * 4;
        data[index] = data[index + 1] = data[index + 2] = value;
      }
    }
  });

  const morphologyVariant = (dataUrl, operation) => canvasDataUrl(dataUrl, (imageData, width, height) => {
    const data = imageData.data;
    const threshold = otsuThreshold(grayscaleHistogram(imageData));
    const foreground = new Uint8Array(width * height);
    for (let pixel = 0, index = 0; index < data.length; index += 4, pixel += 1) {
      const gray = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
      foreground[pixel] = gray < threshold ? 1 : 0;
    }

    const morph = (source, dilate, radiusX = 1, radiusY = 1) => {
      const output = new Uint8Array(source.length);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          let result = dilate ? 0 : 1;
          scanNeighborhood:
          for (let offsetY = -radiusY; offsetY <= radiusY; offsetY += 1) {
            const sampleY = Math.max(0, Math.min(height - 1, y + offsetY));
            for (let offsetX = -radiusX; offsetX <= radiusX; offsetX += 1) {
              const sampleX = Math.max(0, Math.min(width - 1, x + offsetX));
              const sample = source[sampleY * width + sampleX];
              if (dilate && sample) {
                result = 1;
                break scanNeighborhood;
              }
              if (!dilate && !sample) {
                result = 0;
                break scanNeighborhood;
              }
            }
          }
          output[y * width + x] = result;
        }
      }
      return output;
    };

    let processed;
    if (operation === "separate") {
      processed = morph(foreground, false);
    } else {
      processed = morph(foreground, true, 0, 10);
      processed = morph(processed, false, 0, 10);
      processed = morph(processed, true, 4, 0);
      processed = morph(processed, false, 4, 0);
    }
    for (let pixel = 0, index = 0; index < data.length; index += 4, pixel += 1) {
      const value = processed[pixel] ? 0 : 255;
      data[index] = data[index + 1] = data[index + 2] = value;
    }
  });

  const enhancedVariants = async (dataUrl, includeMorphology = true) => {
    const variants = [dataUrl];
    variants.push(await canvasDataUrl(dataUrl, (imageData, width, height) => {
      const data = imageData.data;
      const histogram = grayscaleHistogram(imageData);
      const low = histogramPercentile(histogram, 0.03);
      const high = Math.max(low + 24, histogramPercentile(histogram, 0.97));
      const grayValues = new Uint8ClampedArray(width * height);
      for (let pixel = 0, index = 0; index < data.length; index += 4, pixel += 1) {
        const gray = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
        grayValues[pixel] = Math.max(0, Math.min(255, (gray - low) * 255 / (high - low)));
      }
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const pixel = y * width + x;
          const center = grayValues[pixel];
          let value = center;
          if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
            const neighbors = grayValues[pixel - 1] + grayValues[pixel + 1]
              + grayValues[pixel - width] + grayValues[pixel + width];
            value = Math.max(0, Math.min(255, center * 2.2 - neighbors * 0.3));
          }
          const index = pixel * 4;
          data[index] = data[index + 1] = data[index + 2] = value;
        }
      }
    }));

    variants.push(await canvasDataUrl(dataUrl, imageData => {
      const data = imageData.data;
      const threshold = otsuThreshold(grayscaleHistogram(imageData));
      for (let index = 0; index < data.length; index += 4) {
        const gray = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
        const value = gray >= threshold ? 255 : 0;
        data[index] = data[index + 1] = data[index + 2] = value;
      }
    }));

    variants.push(await localAdaptiveVariant(dataUrl));
    if (includeMorphology) {
      variants.push(await morphologyVariant(dataUrl, "separate"));
      variants.push(await morphologyVariant(dataUrl, "repair"));
    }
    return variants;
  };

  const splitIntoSixGlyphs = async dataUrl => {
    const image = await loadImage(dataUrl);
    const source = document.createElement("canvas");
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const scale = Math.min(1, 1400 / Math.max(sourceWidth, sourceHeight));
    source.width = Math.max(1, Math.round(sourceWidth * scale));
    source.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = source.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, source.width, source.height);
    const imageData = context.getImageData(0, 0, source.width, source.height);
    const pixels = imageData.data;
    const histogram = grayscaleHistogram(imageData);
    const low = histogramPercentile(histogram, 0.05);
    const high = histogramPercentile(histogram, 0.95);
    const darkText = histogramPercentile(histogram, 0.50) >= (low + high) / 2;
    const threshold = Math.max(24, (high - low) * 0.20);
    const corners = [
      [2, 2],
      [source.width - 3, 2],
      [2, source.height - 3],
      [source.width - 3, source.height - 3]
    ];
    const background = corners.reduce((sum, [x, y]) => {
      const index = (Math.max(0, y) * source.width + Math.max(0, x)) * 4;
      return sum + pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
    }, 0) / corners.length;
    const isInk = (x, y) => {
      const index = (y * source.width + x) * 4;
      const gray = pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
      if (Math.abs(gray - background) >= threshold) return true;
      return darkText ? gray <= low + (high - low) * 0.42 : gray >= low + (high - low) * 0.58;
    };

    const columnInk = new Uint32Array(source.width);
    const rowInk = new Uint32Array(source.height);
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        if (!isInk(x, y)) continue;
        columnInk[x] += 1;
        rowInk[y] += 1;
      }
    }

    const minimumColumnInk = Math.max(2, Math.round(source.height * 0.025));
    const minimumRowInk = Math.max(2, Math.round(source.width * 0.018));
    let minX = 0;
    let maxX = source.width - 1;
    let minY = 0;
    let maxY = source.height - 1;
    while (minX < maxX && columnInk[minX] < minimumColumnInk) minX += 1;
    while (maxX > minX && columnInk[maxX] < minimumColumnInk) maxX -= 1;
    while (minY < maxY && rowInk[minY] < minimumRowInk) minY += 1;
    while (maxY > minY && rowInk[maxY] < minimumRowInk) maxY -= 1;
    if (maxX - minX < source.width * 0.18 || maxY - minY < source.height * 0.15) return [];

    const activeColumns = [];
    const bridgeLimit = Math.max(1, Math.round((maxY - minY + 1) * 0.025));
    for (let x = minX; x <= maxX; x += 1) activeColumns[x] = columnInk[x] >= minimumColumnInk;
    for (let x = minX; x <= maxX; x += 1) {
      if (activeColumns[x]) continue;
      let end = x;
      while (end <= maxX && !activeColumns[end]) end += 1;
      if (x > minX && end <= maxX && end - x <= bridgeLimit) {
        for (let fill = x; fill < end; fill += 1) activeColumns[fill] = true;
      }
      x = end;
    }

    let runs = [];
    let runStart = -1;
    for (let x = minX; x <= maxX + 1; x += 1) {
      if (x <= maxX && activeColumns[x]) {
        if (runStart < 0) runStart = x;
      } else if (runStart >= 0) {
        runs.push({ start: runStart, end: x - 1 });
        runStart = -1;
      }
    }
    while (runs.length > 6) {
      let mergeIndex = 0;
      let smallestGap = Infinity;
      for (let index = 0; index < runs.length - 1; index += 1) {
        const gap = runs[index + 1].start - runs[index].end - 1;
        if (gap < smallestGap) {
          smallestGap = gap;
          mergeIndex = index;
        }
      }
      runs.splice(mergeIndex, 2, {
        start: runs[mergeIndex].start,
        end: runs[mergeIndex + 1].end
      });
    }

    let boundaries;
    if (runs.length === 6) {
      boundaries = runs.map((run, index) => {
        const left = index === 0
          ? minX
          : Math.floor((runs[index - 1].end + run.start) / 2) + 1;
        const right = index === runs.length - 1
          ? maxX
          : Math.floor((run.end + runs[index + 1].start) / 2);
        return { left, right };
      });
    } else {
      const contentWidth = maxX - minX + 1;
      boundaries = Array.from({ length: 6 }, (_, index) => ({
        left: Math.round(minX + contentWidth * index / 6),
        right: Math.round(minX + contentWidth * (index + 1) / 6) - 1
      }));
    }

    return boundaries.map(({ left, right }) => {
      const padX = Math.max(2, Math.round((right - left + 1) * 0.10));
      const padY = Math.max(2, Math.round((maxY - minY + 1) * 0.10));
      const cropLeft = Math.max(0, left - padX);
      const cropTop = Math.max(0, minY - padY);
      const cropRight = Math.min(source.width - 1, right + padX);
      const cropBottom = Math.min(source.height - 1, maxY + padY);
      const cropWidth = cropRight - cropLeft + 1;
      const cropHeight = cropBottom - cropTop + 1;
      const output = document.createElement("canvas");
      output.width = 260;
      output.height = 300;
      const outputContext = output.getContext("2d", { alpha: false });
      outputContext.fillStyle = "#FFFFFF";
      outputContext.fillRect(0, 0, output.width, output.height);
      const fit = Math.min(220 / cropWidth, 260 / cropHeight);
      const drawWidth = Math.max(1, Math.round(cropWidth * fit));
      const drawHeight = Math.max(1, Math.round(cropHeight * fit));
      outputContext.imageSmoothingEnabled = true;
      outputContext.imageSmoothingQuality = "high";
      outputContext.drawImage(
        source,
        cropLeft,
        cropTop,
        cropWidth,
        cropHeight,
        Math.round((output.width - drawWidth) / 2),
        Math.round((output.height - drawHeight) / 2),
        drawWidth,
        drawHeight
      );
      return output.toDataURL("image/png");
    });
  };

  const rerankWithGlyphChecks = async (worker, ranked, sourceDataUrl, scanDeadline, scanId) => {
    if (!ranked.length || !sourceDataUrl || scanDeadline - Date.now() < 4500) return ranked;
    const seedMap = new Map();
    const addSeed = item => {
      const code = normalizeCode(item && item.code ? item.code : "");
      if (!VALID_CODE.test(code) || seedMap.has(code)) return;
      seedMap.set(code, { ...item, code });
    };
    ranked.forEach(addSeed);
    uploadedCodes()
      .filter(code => code !== ranked[0].code)
      .map(code => ({ code, distance: codeDistance(ranked[0].code, code) }))
      .filter(match => match.distance <= 1.5)
      .sort((left, right) => left.distance - right.distance || formatWeight(right.code) - formatWeight(left.code))
      .slice(0, 4)
      .forEach(match => addSeed({
        code: match.code,
        reason: "close uploaded inventory alternative",
        inventoryDistance: match.distance
      }));
    visualAlternatives(ranked[0].code).forEach(code => addSeed({
      code,
      reason: "possible visual character variation - independently rechecked"
    }));
    const choiceSeeds = [...seedMap.values()].slice(0, 12);
    if (choiceSeeds.length < 2) return ranked;

    const baseByCode = new Map(ranked.map(item => [item.code, item]));
    const bestScore = ranked[0].score;
    const fallbackPenalty = Math.max(260, bestScore * 0.045);
    const candidates = choiceSeeds.map((item, index) => {
      const existing = baseByCode.get(item.code);
      return existing
        ? { ...existing }
        : {
            ...item,
            score: bestScore
              - fallbackPenalty
              - Math.max(0, (item.inventoryDistance || codeDistance(ranked[0].code, item.code)) - 0.25) * 110
              + (knownInventoryMatch(item.code) ? 500 : 0)
              + (formatWeight(item.code) - formatWeight(ranked[0].code)) * 0.35
              - index * 4,
            appearances: 0,
            confidence: 0
          };
    });
    const disputedPositions = Array.from({ length: 6 }, (_, position) => position)
      .filter(position => new Set(candidates.map(item => item.code[position])).size > 1)
      .slice(0, 2);
    if (!disputedPositions.length) return ranked;

    const glyphs = await splitIntoSixGlyphs(sourceDataUrl);
    confirmActiveScan(scanId);
    if (glyphs.length !== 6) return ranked;
    setOcrStatus("OCR CHECKING UNCERTAIN CHARACTERS...", "info");

    let workerWasReset = false;
    characterChecks:
    for (const position of disputedPositions) {
      confirmActiveScan(scanId);
      if (scanDeadline - Date.now() < 2200) break;
      const whitelist = [...new Set(candidates.map(item => item.code[position]))]
        .filter(character => ALLOWED_OCR_CHARACTERS.includes(character))
        .join("");
      if (whitelist.length < 2) continue;
      const glyphVariants = [glyphs[position]];
      if (scanDeadline - Date.now() >= 4200) {
        glyphVariants.push(await localAdaptiveVariant(glyphs[position]));
        confirmActiveScan(scanId);
      }

      for (const glyphDataUrl of glyphVariants) {
        const remainingMilliseconds = scanDeadline - Date.now();
        if (remainingMilliseconds < 1800) break;
        try {
          await worker.setParameters({
            tessedit_pageseg_mode: "10",
            tessedit_char_whitelist: whitelist
          });
          const result = await withOcrTimeout(
            worker.recognize(glyphDataUrl),
            Math.min(3000, remainingMilliseconds),
            "OCR CHARACTER CHECK TIMED OUT."
          );
          confirmActiveScan(scanId);
          const raw = normalizeUpperText(result && result.data ? result.data.text || "" : "")
            .replace(/[^A-Z0-9]/g, "");
          const observed = [...raw].find(character => whitelist.includes(character));
          if (!observed) continue;
          const confidence = Math.max(0, Math.min(100, Number(result && result.data ? result.data.confidence : 0) || 0));
          const evidence = 260 + confidence * 4.2;
          candidates.forEach(candidate => {
            if (candidate.code[position] !== observed) return;
            candidate.score += evidence;
            candidate.confidence = Math.max(candidate.confidence || 0, Math.round(confidence));
            candidate.reason = [candidate.reason, "character " + (position + 1) + " independently rechecked as " + observed]
              .filter(Boolean)
              .slice(-2)
              .join("; ");
          });
        } catch (error) {
          if (error && error.name === "AbortError") throw error;
          if (error && /TIMED OUT/i.test(error.message || "")) {
            await resetOcrWorker();
            workerWasReset = true;
            break characterChecks;
          }
          break;
        }
      }
    }

    if (!workerWasReset) {
      try {
        await worker.setParameters({
          tessedit_pageseg_mode: "7",
          tessedit_char_whitelist: ALLOWED_OCR_CHARACTERS
        });
      } catch {}
    }
    confirmActiveScan(scanId);
    return candidates.sort((left, right) => right.score - left.score).slice(0, 3);
  };

  const assessImageQuality = async dataUrl => {
    const image = await loadImage(dataUrl);
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 640 / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const histogram = grayscaleHistogram(imageData);
    const low = histogramPercentile(histogram, 0.05);
    const high = histogramPercentile(histogram, 0.95);
    if (high - low < 38) return "LOW CONTRAST - VERIFY EACH CHARACTER CAREFULLY. ";
    if (low > 220) return "VERY BRIGHT PHOTO - VERIFY EACH CHARACTER CAREFULLY. ";
    if (high < 45) return "VERY DARK PHOTO - VERIFY EACH CHARACTER CAREFULLY. ";
    return "";
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

  const compactVerticalGlyphSpacing = async dataUrl => {
    const image = await loadImage(dataUrl);
    const source = document.createElement("canvas");
    source.width = image.naturalWidth || image.width;
    source.height = image.naturalHeight || image.height;
    const context = source.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, source.width, source.height);
    const pixels = context.getImageData(0, 0, source.width, source.height).data;
    const corners = [
      [2, 2],
      [source.width - 3, 2],
      [2, source.height - 3],
      [source.width - 3, source.height - 3]
    ];
    const background = corners.reduce((sum, [x, y]) => {
      const index = (Math.max(0, y) * source.width + Math.max(0, x)) * 4;
      return sum + pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
    }, 0) / corners.length;
    const isInk = (x, y) => {
      const index = (y * source.width + x) * 4;
      const gray = pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
      return Math.abs(gray - background) >= 48;
    };

    let minY = source.height;
    let maxY = -1;
    const activeColumns = new Array(source.width).fill(false);
    const minimumInkPerColumn = Math.max(2, Math.round(source.height * 0.015));
    for (let x = 0; x < source.width; x += 1) {
      let inkCount = 0;
      for (let y = 0; y < source.height; y += 1) {
        if (!isInk(x, y)) continue;
        inkCount += 1;
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      activeColumns[x] = inkCount >= minimumInkPerColumn;
    }
    if (maxY <= minY) return dataUrl;

    const runs = [];
    let runStart = -1;
    for (let x = 0; x <= source.width; x += 1) {
      if (x < source.width && activeColumns[x]) {
        if (runStart < 0) runStart = x;
      } else if (runStart >= 0) {
        runs.push({ start: runStart, end: x - 1 });
        runStart = -1;
      }
    }
    if (runs.length < 5 || runs.length > 8) return dataUrl;

    const contentHeight = maxY - minY + 1;
    const glyphPad = Math.max(2, Math.round(contentHeight * 0.025));
    const gap = Math.max(8, Math.round(contentHeight * 0.14));
    const verticalPad = Math.max(10, Math.round(contentHeight * 0.12));
    const paddedRuns = runs.map(run => ({
      start: Math.max(0, run.start - glyphPad),
      end: Math.min(source.width - 1, run.end + glyphPad)
    }));
    const outputWidth = paddedRuns.reduce((sum, run) => sum + run.end - run.start + 1, 0)
      + gap * (paddedRuns.length - 1)
      + glyphPad * 2;
    const output = document.createElement("canvas");
    output.width = outputWidth;
    output.height = contentHeight + verticalPad * 2;
    const outputContext = output.getContext("2d", { alpha: false });
    const backgroundValue = Math.max(0, Math.min(255, Math.round(background)));
    outputContext.fillStyle = `rgb(${backgroundValue}, ${backgroundValue}, ${backgroundValue})`;
    outputContext.fillRect(0, 0, output.width, output.height);
    let drawX = glyphPad;
    paddedRuns.forEach(run => {
      const width = run.end - run.start + 1;
      outputContext.drawImage(
        source,
        run.start,
        minY,
        width,
        contentHeight,
        drawX,
        verticalPad,
        width,
        contentHeight
      );
      drawX += width + gap;
    });
    return output.toDataURL("image/jpeg", 0.96);
  };

  const recomposeStackedVerticalGlyphs = async dataUrl => {
    const image = await loadImage(dataUrl);
    const source = document.createElement("canvas");
    source.width = image.naturalWidth || image.width;
    source.height = image.naturalHeight || image.height;
    const context = source.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, source.width, source.height);
    const pixels = context.getImageData(0, 0, source.width, source.height).data;
    const corners = [
      [2, 2],
      [source.width - 3, 2],
      [2, source.height - 3],
      [source.width - 3, source.height - 3]
    ];
    const background = corners.reduce((sum, [x, y]) => {
      const index = (Math.max(0, y) * source.width + Math.max(0, x)) * 4;
      return sum + pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
    }, 0) / corners.length;
    const isInk = (x, y) => {
      const index = (y * source.width + x) * 4;
      const gray = pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
      return Math.abs(gray - background) >= 48;
    };

    let minX = source.width;
    let maxX = -1;
    const activeRows = new Array(source.height).fill(false);
    const minimumInkPerRow = Math.max(2, Math.round(source.width * 0.015));
    for (let y = 0; y < source.height; y += 1) {
      let inkCount = 0;
      for (let x = 0; x < source.width; x += 1) {
        if (!isInk(x, y)) continue;
        inkCount += 1;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
      activeRows[y] = inkCount >= minimumInkPerRow;
    }
    if (maxX <= minX) return dataUrl;

    const runs = [];
    let runStart = -1;
    for (let y = 0; y <= source.height; y += 1) {
      if (y < source.height && activeRows[y]) {
        if (runStart < 0) runStart = y;
      } else if (runStart >= 0) {
        runs.push({ start: runStart, end: y - 1 });
        runStart = -1;
      }
    }
    if (runs.length < 5 || runs.length > 8) return dataUrl;

    const contentWidth = maxX - minX + 1;
    const horizontalPad = Math.max(8, Math.round(contentWidth * 0.10));
    const verticalPad = Math.max(8, Math.round(contentWidth * 0.10));
    const gap = Math.max(8, Math.round(contentWidth * 0.14));
    const glyphWidth = contentWidth + horizontalPad * 2;
    const maximumGlyphHeight = Math.max(...runs.map(run => run.end - run.start + 1));
    const output = document.createElement("canvas");
    output.width = glyphWidth * runs.length + gap * (runs.length - 1);
    output.height = maximumGlyphHeight + verticalPad * 2;
    const outputContext = output.getContext("2d", { alpha: false });
    const backgroundValue = Math.max(0, Math.min(255, Math.round(background)));
    outputContext.fillStyle = `rgb(${backgroundValue}, ${backgroundValue}, ${backgroundValue})`;
    outputContext.fillRect(0, 0, output.width, output.height);
    runs.forEach((run, index) => {
      const glyphHeight = run.end - run.start + 1;
      const drawX = index * (glyphWidth + gap) + horizontalPad;
      const drawY = verticalPad + Math.round((maximumGlyphHeight - glyphHeight) / 2);
      outputContext.drawImage(
        source,
        minX,
        run.start,
        contentWidth,
        glyphHeight,
        drawX,
        drawY,
        contentWidth,
        glyphHeight
      );
    });
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

  const visualAlternatives = code => {
    const normalized = normalizeCode(code || "");
    if (!VALID_CODE.test(normalized)) return [];
    const alternatives = new Set();
    const add = value => {
      if (value !== normalized && VALID_CODE.test(value)) alternatives.add(value);
    };

    if (/^[DBC]\d{5}$/.test(normalized)) {
      ["D", "8", "C", "B"].forEach(prefix => add(prefix + normalized.slice(1)));
    } else if (/^[378]\d{5}$/.test(normalized)) {
      ["8", "7", "3"].forEach(prefix => add(prefix + normalized.slice(1)));
      if (normalized[0] === "8") {
        add("B" + normalized.slice(1));
        add("D" + normalized.slice(1));
      }
    } else if (/^(?:ZM|TR|PS)\d{4}$/.test(normalized)) {
      ["ZM", "TR", "PS"].forEach(prefix => add(prefix + normalized.slice(2)));
    }

    const digitAlternatives = {
      "0": ["8"],
      "1": ["7"],
      "3": ["8"],
      "5": ["6"],
      "6": ["5"],
      "7": ["1"],
      "8": ["3", "0"]
    };
    for (let index = 0; index < normalized.length; index += 1) {
      (digitAlternatives[normalized[index]] || []).forEach(replacement => {
        add(normalized.slice(0, index) + replacement + normalized.slice(index + 1));
      });
    }
    return [...alternatives];
  };

  const completeSuggestionChoices = suggestions => {
    const choices = new Map();
    const add = item => {
      const code = normalizeCode(item && item.code ? item.code : "");
      if (!VALID_CODE.test(code) || choices.has(code)) return;
      choices.set(code, { ...item, code });
    };
    suggestions.forEach(add);
    const primary = [...choices.values()][0];
    if (!primary) return [];

    uploadedCodes()
      .filter(code => code !== primary.code)
      .map(code => ({ code, distance: codeDistance(primary.code, code) }))
      .filter(match => match.distance <= 1.5)
      .sort((left, right) => left.distance - right.distance || formatWeight(right.code) - formatWeight(left.code))
      .forEach(match => add({
        code: match.code,
        reason: "close uploaded inventory alternative"
      }));

    visualAlternatives(primary.code).forEach(code => add({
      code,
      reason: "possible visual character variation - verify carefully"
    }));
    return [...choices.values()].slice(0, 3);
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
      const qualityNote = await assessImageQuality(originalImageData);
      confirmActiveScan(scanId);
      const attemptGroups = [];
      if (ocrCropOrientation === "vertical") {
        const clockwise = await rotateImageDataUrl(originalImageData, 90);
        confirmActiveScan(scanId);
        const counterclockwise = await rotateImageDataUrl(originalImageData, -90);
        confirmActiveScan(scanId);
        const clockwiseAdaptive = await localAdaptiveVariant(clockwise);
        confirmActiveScan(scanId);
        const counterclockwiseAdaptive = await localAdaptiveVariant(counterclockwise);
        confirmActiveScan(scanId);
        const [clockwiseFocused, counterclockwiseFocused] = await Promise.all([
          foregroundTightCrop(clockwise),
          foregroundTightCrop(counterclockwise)
        ]);
        confirmActiveScan(scanId);
        const clockwiseAdaptiveFocused = await foregroundTightCrop(clockwiseAdaptive);
        confirmActiveScan(scanId);
        const counterclockwiseAdaptiveFocused = await foregroundTightCrop(counterclockwiseAdaptive);
        confirmActiveScan(scanId);
        const [clockwiseCompacted, counterclockwiseCompacted] = await Promise.all([
          compactVerticalGlyphSpacing(clockwiseFocused),
          compactVerticalGlyphSpacing(counterclockwiseFocused)
        ]);
        confirmActiveScan(scanId);
        const clockwiseAdaptiveCompacted = await compactVerticalGlyphSpacing(clockwiseAdaptiveFocused);
        confirmActiveScan(scanId);
        const counterclockwiseAdaptiveCompacted = await compactVerticalGlyphSpacing(counterclockwiseAdaptiveFocused);
        confirmActiveScan(scanId);
        const stackedFocused = await foregroundTightCrop(originalImageData);
        confirmActiveScan(scanId);
        const stackedCompacted = await recomposeStackedVerticalGlyphs(stackedFocused);
        confirmActiveScan(scanId);
        const [clockwiseVariants, counterclockwiseVariants] = await Promise.all([
          enhancedVariants(clockwiseCompacted, false),
          enhancedVariants(counterclockwiseCompacted, false)
        ]);
        confirmActiveScan(scanId);
        // Vertical labels can read in either direction. The focused crop keeps
        // edge characters, then word, line, and raw-line modes vote together.
        if (stackedCompacted !== stackedFocused) {
          const stackedVariants = await enhancedVariants(stackedCompacted, false);
          confirmActiveScan(scanId);
          attemptGroups.push([
            { dataUrl: stackedVariants[3], pageSegMode: "7", whitelist: ALLOWED_OCR_CHARACTERS, reliabilityBonus: 180 },
            { dataUrl: stackedVariants[0], pageSegMode: "7", whitelist: ALLOWED_OCR_CHARACTERS, reliabilityBonus: 120 }
          ]);
        }
        attemptGroups.push([
          { dataUrl: clockwiseAdaptiveCompacted, pageSegMode: "7", whitelist: ALLOWED_OCR_CHARACTERS, reliabilityBonus: 120 },
          { dataUrl: clockwiseVariants[0], pageSegMode: "8", whitelist: ALLOWED_OCR_CHARACTERS, reliabilityBonus: 0 },
          { dataUrl: clockwiseVariants[1], pageSegMode: "7", whitelist: DIGIT_OCR_CHARACTERS, reliabilityBonus: 30 }
        ]);
        attemptGroups.push([
          { dataUrl: counterclockwiseAdaptiveCompacted, pageSegMode: "7", whitelist: ALLOWED_OCR_CHARACTERS, reliabilityBonus: 120 },
          { dataUrl: counterclockwiseVariants[0], pageSegMode: "8", whitelist: ALLOWED_OCR_CHARACTERS, reliabilityBonus: 0 },
          { dataUrl: counterclockwiseVariants[1], pageSegMode: "7", whitelist: DIGIT_OCR_CHARACTERS, reliabilityBonus: 30 }
        ]);
      } else {
        const tight = await autoTightCrop(originalImageData);
        confirmActiveScan(scanId);
        const bases = tight === originalImageData ? [originalImageData] : [tight, originalImageData];
        const orientationAttempts = [];
        for (const [baseIndex, base] of bases.entries()) {
          const variants = await enhancedVariants(base);
          confirmActiveScan(scanId);
          const selectedIndexes = bases.length > 1
            ? (baseIndex === 0 ? [0, 1, 3, 4, 5] : [0])
            : [0, 1, 2, 3, 4, 5];
          orientationAttempts.push(...selectedIndexes.map(variantIndex => ({
            dataUrl: variants[variantIndex],
            pageSegMode: variantIndex === 4 ? "13" : "7",
            whitelist: variantIndex === 1 ? DIGIT_OCR_CHARACTERS : ALLOWED_OCR_CHARACTERS,
            reliabilityBonus: variantIndex === 3
              ? 120
              : variantIndex === 4 || variantIndex === 5
              ? 80
              : variantIndex === 1
              ? 30
              : variantIndex === 2
              ? 20
              : 0
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

      const worker = await withOcrTimeout(getOcrWorker(), 15000, "OCR STARTUP TIMED OUT. TRY AGAIN OR TYPE THE NUMBER MANUALLY.");
      confirmActiveScan(scanId);
      try {
        await worker.setParameters({
          tessedit_char_whitelist: ALLOWED_OCR_CHARACTERS,
          preserve_interword_spaces: "0",
          classify_enable_learning: "0"
        });
      } catch {}
      confirmActiveScan(scanId);

      const totals = new Map();
      const appearances = new Map();
      const confidenceByCode = new Map();
      const reasonByCode = new Map();
      const bestAttemptByCode = new Map();
      const positionVotes = Array.from({ length: 6 }, () => new Map());
      const partialReads = new Set();
      let activePageSegMode = "";
      let activeWhitelist = "";
      let lastText = "";
      const scanDeadline = Date.now() + 40000;

      for (const [attemptIndex, attempt] of imageAttempts.entries()) {
        confirmActiveScan(scanId);
        const remainingMilliseconds = scanDeadline - Date.now();
        if (remainingMilliseconds < 2500) break;
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
          Math.min(8500, remainingMilliseconds),
          "OCR IMAGE PASS TIMED OUT. TRY AGAIN OR TYPE THE NUMBER MANUALLY."
        );
        confirmActiveScan(scanId);
        lastText = result && result.data ? result.data.text || "" : "";
        previewCandidateTexts(lastText).forEach(read => partialReads.add(read));
        const confidence = Number(result && result.data ? result.data.confidence : 0) || 0;
        const passCandidates = priorityCandidateObjects(lastText).slice(0, 6);
        passCandidates.forEach((candidate, rank) => {
          const contribution = candidate.score + Math.max(0, 45 - rank * 8) + confidence * 0.4 + (attempt.reliabilityBonus || 0);
          totals.set(candidate.code, (totals.get(candidate.code) || 0) + contribution);
          const previousAttempt = bestAttemptByCode.get(candidate.code);
          if (!previousAttempt || contribution > previousAttempt.contribution) {
            bestAttemptByCode.set(candidate.code, { dataUrl: attempt.dataUrl, contribution });
          }
          appearances.set(candidate.code, (appearances.get(candidate.code) || 0) + 1);
          confidenceByCode.set(candidate.code, Math.max(confidenceByCode.get(candidate.code) || 0, confidence));
          if (candidate.reason) {
            const reasons = reasonByCode.get(candidate.code) || new Set();
            reasons.add(candidate.reason);
            reasonByCode.set(candidate.code, reasons);
          }
        });
        passCandidates.slice(0, 3).forEach((candidate, rank) => {
          const vote = 60 * (3 - rank) + (attempt.reliabilityBonus || 0) + (knownInventoryMatch(candidate.code) ? 180 : 0);
          [...candidate.code].forEach((character, position) => {
            const votes = positionVotes[position];
            votes.set(character, (votes.get(character) || 0) + vote);
          });
        });
      }

      const consensusCode = positionVotes.map(votes => {
        return [...votes.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || "";
      }).join("");
      if (VALID_CODE.test(consensusCode) && !totals.has(consensusCode)) {
        const consensusScore = formatWeight(consensusCode)
          + (knownInventoryMatch(consensusCode) ? 1600 : 0)
          + 85;
        totals.set(consensusCode, consensusScore);
        appearances.set(consensusCode, 1);
        confidenceByCode.set(consensusCode, 0);
        reasonByCode.set(consensusCode, new Set(["character-by-character agreement across OCR passes"]));
      }

      let ranked = [...totals.entries()]
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

      const recheckSource = bestAttemptByCode.get(ranked[0].code)?.dataUrl || imageAttempts[0]?.dataUrl;
      ranked = await rerankWithGlyphChecks(worker, ranked, recheckSource, scanDeadline, scanId);
      confirmActiveScan(scanId);
      const best = ranked[0];
      const choices = completeSuggestionChoices(ranked);
      showOcrReview(best.code, "BEST SUGGESTION: " + best.code + ". " + qualityNote + (best.reason ? best.reason.toUpperCase() + ". " : "") + (knownInventoryMatch(best.code) ? "MATCHES THE UPLOADED INVENTORY. " : "") + (best.appearances > 1 ? "SUPPORTED BY MULTIPLE IMAGE PASSES. " : "SINGLE-PASS RESULT - CHECK CAREFULLY. ") + "SELECT AN OPTION OR EDIT THE NUMBER, VERIFY THE PHOTO, THEN CONFIRM & SAVE.", "warning");
      showSuggestions(choices);
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
