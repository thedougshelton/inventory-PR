(function (global) {
  "use strict";

  const DRAWING_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing";
  const IMAGE_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
  const DRAWING_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.drawing+xml";
  const EMU_PER_PIXEL = 9525;

  function xmlEscape(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function xmlUnescape(value) {
    return String(value || "")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&gt;/g, ">")
      .replace(/&lt;/g, "<")
      .replace(/&amp;/g, "&");
  }

  function attributeValue(tag, name) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = tag.match(new RegExp("\\b" + escapedName + "=(?:\"([^\"]*)\"|'([^']*)')"));
    return match ? xmlUnescape(match[1] === undefined ? match[2] : match[1]) : "";
  }

  function normalizeZipPath(path) {
    const parts = [];
    String(path || "").replace(/\\/g, "/").split("/").forEach(part => {
      if (!part || part === ".") return;
      if (part === "..") parts.pop();
      else parts.push(part);
    });
    return parts.join("/");
  }

  function resolveRelationshipTarget(sourcePath, target) {
    if (String(target || "").startsWith("/")) return normalizeZipPath(String(target).slice(1));
    const sourceDirectory = sourcePath.slice(0, sourcePath.lastIndexOf("/") + 1);
    return normalizeZipPath(sourceDirectory + target);
  }

  function relationshipPath(partPath) {
    const slash = partPath.lastIndexOf("/");
    const directory = slash === -1 ? "" : partPath.slice(0, slash + 1);
    const filename = slash === -1 ? partPath : partPath.slice(slash + 1);
    return directory + "_rels/" + filename + ".rels";
  }

  function nextRelationshipId(xml) {
    let maximum = 0;
    const pattern = /\bId=(?:"rId(\d+)"|'rId(\d+)')/g;
    let match;
    while ((match = pattern.exec(xml))) maximum = Math.max(maximum, Number(match[1] || match[2] || 0));
    return "rId" + (maximum + 1);
  }

  function appendXmlElement(xml, closingTag, element) {
    const index = xml.lastIndexOf(closingTag);
    if (index === -1) throw new Error("The Excel workbook is missing " + closingTag + ".");
    return xml.slice(0, index) + element + xml.slice(index);
  }

  function parseImageDataUrl(dataUrl) {
    const match = String(dataUrl || "").match(/^data:image\/(png|jpe?g);base64,([a-z0-9+/=\s]+)$/i);
    if (!match) return null;
    const extension = match[1].toLowerCase() === "png" ? "png" : "jpeg";
    return { extension, base64: match[2].replace(/\s/g, "") };
  }

  function findWorksheetPath(workbookXml, workbookRelationshipsXml, sheetName) {
    const sheetTags = workbookXml.match(/<sheet\b[^>]*\/?\s*>/g) || [];
    const sheetTag = sheetTags.find(tag => attributeValue(tag, "name") === sheetName);
    if (!sheetTag) throw new Error("The " + sheetName + " worksheet is missing.");
    const relationshipId = attributeValue(sheetTag, "r:id");
    const relationshipTags = workbookRelationshipsXml.match(/<Relationship\b[^>]*\/?\s*>/g) || [];
    const relationshipTag = relationshipTags.find(tag => attributeValue(tag, "Id") === relationshipId);
    if (!relationshipTag) throw new Error("The " + sheetName + " worksheet relationship is missing.");
    return resolveRelationshipTarget("xl/workbook.xml", attributeValue(relationshipTag, "Target"));
  }

  function nextAvailableDrawingNumber(zip) {
    let number = 1;
    while (zip.file("xl/drawings/drawing" + number + ".xml")) number += 1;
    return number;
  }

  function nextAvailableMediaPath(zip, preferredNumber, extension) {
    let number = preferredNumber;
    let path = "xl/media/inventory-photo-" + number + "." + extension;
    while (zip.file(path)) {
      number += 1;
      path = "xl/media/inventory-photo-" + number + "." + extension;
    }
    return path;
  }

  function drawingAnchorXml(item, relationshipId, pictureId) {
    const width = Math.max(1, Number(item.widthPx) || 96);
    const height = Math.max(1, Number(item.heightPx) || 72);
    const rowIndex = Math.max(1, Number(item.rowIndex) || 1);
    const name = xmlEscape(item.name || "INVENTORY PHOTO " + pictureId);
    const description = xmlEscape(item.description || name);
    const cx = Math.round(width * EMU_PER_PIXEL);
    const cy = Math.round(height * EMU_PER_PIXEL);
    const xOffset = Math.round(8 * EMU_PER_PIXEL);
    const yOffset = Math.round(2 * EMU_PER_PIXEL);

    return '<xdr:oneCellAnchor>' +
      '<xdr:from><xdr:col>0</xdr:col><xdr:colOff>' + xOffset + '</xdr:colOff><xdr:row>' + rowIndex + '</xdr:row><xdr:rowOff>' + yOffset + '</xdr:rowOff></xdr:from>' +
      '<xdr:ext cx="' + cx + '" cy="' + cy + '"/>' +
      '<xdr:pic>' +
        '<xdr:nvPicPr><xdr:cNvPr id="' + pictureId + '" name="' + name + '" descr="' + description + '"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>' +
        '<xdr:blipFill><a:blip r:embed="' + relationshipId + '"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
        '<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln><a:noFill/></a:ln></xdr:spPr>' +
      '</xdr:pic><xdr:clientData/>' +
    '</xdr:oneCellAnchor>';
  }

  async function embedPictures(workbookBytes, sheetName, items) {
    if (!global.JSZip) throw new Error("The photo export library did not load.");
    const zip = await global.JSZip.loadAsync(workbookBytes);
    const workbookFile = zip.file("xl/workbook.xml");
    const workbookRelationshipsFile = zip.file("xl/_rels/workbook.xml.rels");
    if (!workbookFile || !workbookRelationshipsFile) throw new Error("The Excel workbook structure is incomplete.");

    const workbookXml = await workbookFile.async("text");
    const workbookRelationshipsXml = await workbookRelationshipsFile.async("text");
    const worksheetPath = findWorksheetPath(workbookXml, workbookRelationshipsXml, sheetName);
    const worksheetFile = zip.file(worksheetPath);
    if (!worksheetFile) throw new Error("The " + sheetName + " worksheet file is missing.");

    let worksheetXml = await worksheetFile.async("text");
    if (/<drawing\b/i.test(worksheetXml)) throw new Error("The Pictures worksheet already contains a drawing.");

    const drawingNumber = nextAvailableDrawingNumber(zip);
    const drawingPath = "xl/drawings/drawing" + drawingNumber + ".xml";
    const drawingRelationshipsPath = relationshipPath(drawingPath);
    const drawingAnchors = [];
    const drawingRelationships = [];
    let embeddedCount = 0;
    let skippedCount = 0;

    (Array.isArray(items) ? items : []).forEach((item, index) => {
      const image = parseImageDataUrl(item && item.dataUrl);
      if (!image) {
        skippedCount += 1;
        return;
      }
      embeddedCount += 1;
      const relationshipId = "rId" + embeddedCount;
      const mediaPath = nextAvailableMediaPath(zip, index + 1, image.extension);
      zip.file(mediaPath, image.base64, { base64: true, binary: true });
      drawingRelationships.push('<Relationship Id="' + relationshipId + '" Type="' + IMAGE_REL_TYPE + '" Target="../media/' + mediaPath.slice(mediaPath.lastIndexOf("/") + 1) + '"/>');
      drawingAnchors.push(drawingAnchorXml(item, relationshipId, embeddedCount + 1));
    });

    if (!embeddedCount) throw new Error("No valid photo thumbnails were available for Excel.");

    const drawingXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      drawingAnchors.join("") +
      '</xdr:wsDr>';
    const drawingRelationshipsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      drawingRelationships.join("") +
      '</Relationships>';
    zip.file(drawingPath, drawingXml);
    zip.file(drawingRelationshipsPath, drawingRelationshipsXml);

    const worksheetRelationshipsPath = relationshipPath(worksheetPath);
    const existingWorksheetRelationshipsFile = zip.file(worksheetRelationshipsPath);
    let worksheetRelationshipsXml = existingWorksheetRelationshipsFile
      ? await existingWorksheetRelationshipsFile.async("text")
      : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    const worksheetDrawingRelationshipId = nextRelationshipId(worksheetRelationshipsXml);
    worksheetRelationshipsXml = appendXmlElement(
      worksheetRelationshipsXml,
      "</Relationships>",
      '<Relationship Id="' + worksheetDrawingRelationshipId + '" Type="' + DRAWING_REL_TYPE + '" Target="../drawings/drawing' + drawingNumber + '.xml"/>'
    );
    zip.file(worksheetRelationshipsPath, worksheetRelationshipsXml);
    worksheetXml = appendXmlElement(worksheetXml, "</worksheet>", '<drawing r:id="' + worksheetDrawingRelationshipId + '"/>');
    zip.file(worksheetPath, worksheetXml);

    const contentTypesFile = zip.file("[Content_Types].xml");
    if (!contentTypesFile) throw new Error("The Excel content type file is missing.");
    let contentTypesXml = await contentTypesFile.async("text");
    const drawingPartName = "/" + drawingPath;
    if (!contentTypesXml.includes('PartName="' + drawingPartName + '"')) {
      contentTypesXml = appendXmlElement(
        contentTypesXml,
        "</Types>",
        '<Override PartName="' + drawingPartName + '" ContentType="' + DRAWING_CONTENT_TYPE + '"/>'
      );
      zip.file("[Content_Types].xml", contentTypesXml);
    }

    const bytes = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    return { bytes, embeddedCount, skippedCount };
  }

  global.InventoryXlsxPhotos = { embedPictures };
})(typeof window !== "undefined" ? window : globalThis);
