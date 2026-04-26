// calculator-share.js
// Reusable social share card generator + share/download/copy helpers for calculators.
(function () {
  "use strict";

  var WIDTH = 1080;
  var HEIGHT = 1350;

  function track(eventName, params) {
    if (typeof window.gtag !== "function") return;
    window.gtag("event", eventName, params || {});
  }

  function isFiniteNumber(n) {
    return typeof n === "number" && Number.isFinite(n);
  }

  function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight) {
    var words = String(text || "").split(/\s+/).filter(Boolean);
    var lines = [];
    var line = "";
    for (var i = 0; i < words.length; i += 1) {
      var testLine = line ? line + " " + words[i] : words[i];
      if (ctx.measureText(testLine).width > maxWidth && line) {
        lines.push(line);
        line = words[i];
      } else {
        line = testLine;
      }
    }
    if (line) lines.push(line);

    for (var j = 0; j < lines.length; j += 1) {
      ctx.fillText(lines[j], x, y + (j * lineHeight));
    }
    return lines.length;
  }

  function canvasToBlob(canvas) {
    if (typeof canvas.toBlob !== "function") {
      // Older Safari fallback.
      var dataUrl = canvas.toDataURL("image/png");
      var parts = dataUrl.split(",");
      var mimeMatch = parts[0].match(/:(.*?);/);
      var mime = (mimeMatch && mimeMatch[1]) || "image/png";
      var binary = atob(parts[1] || "");
      var len = binary.length;
      var bytes = new Uint8Array(len);
      for (var i = 0; i < len; i += 1) bytes[i] = binary.charCodeAt(i);
      return Promise.resolve(new Blob([bytes], { type: mime }));
    }
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error("Unable to generate PNG blob."));
      }, "image/png");
    });
  }

  function triggerDownload(blob, filename) {
    var objectUrl = URL.createObjectURL(blob);

    // iOS Safari often ignores download attr; opening the image still lets users Save Image.
    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent || "");
    if (isIOS) {
      window.open(objectUrl, "_blank");
      setTimeout(function () {
        URL.revokeObjectURL(objectUrl);
      }, 10000);
      return;
    }

    var link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
      URL.revokeObjectURL(objectUrl);
    }, 2000);
  }

  function copyText(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      return navigator.clipboard.writeText(text);
    }

    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.top = "-9999px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        var ok = document.execCommand("copy");
        ta.remove();
        if (ok) resolve();
        else reject(new Error("Copy command failed"));
      } catch (err) {
        reject(err);
      }
    });
  }

  function buildResultUrl(baseUrl, scenarioOrResultCents, horizonYears) {
    try {
      var url = new URL(baseUrl, window.location.origin);
      url.hash = "";
      if (scenarioOrResultCents && typeof scenarioOrResultCents === "object") {
        Object.keys(scenarioOrResultCents).forEach(function (key) {
          var val = scenarioOrResultCents[key];
          if (val === null || val === undefined || val === "") return;
          url.searchParams.set(key, String(val));
        });
      } else {
        // Backward compatibility with older calls.
        var dollars = Math.round((scenarioOrResultCents || 0) / 100);
        url.searchParams.set("result", String(dollars));
        url.searchParams.set("years", String(horizonYears || ""));
      }
      return url.toString();
    } catch (_err) {
      return baseUrl;
    }
  }

  function createShareCardCanvas(config) {
    var canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    var ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context unavailable");

    var bgTop = "#1f2a3d";
    var bgBottom = "#141c2b";
    var accent = "#d9b46a";
    var text = "#eef2f7";
    var muted = "rgba(238,242,247,0.82)";
    var subtle = "rgba(238,242,247,0.62)";

    var grad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    grad.addColorStop(0, bgTop);
    grad.addColorStop(1, bgBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.fillStyle = "rgba(217,180,106,0.12)";
    ctx.fillRect(80, 80, WIDTH - 160, HEIGHT - 160);

    var left = 110;
    var right = WIDTH - 110;
    var contentWidth = right - left;
    var y = 150;

    ctx.fillStyle = accent;
    ctx.font = "700 42px Arial, sans-serif";
    ctx.fillText(config.brand || "The Long Math", left, y);

    y += 120;
    ctx.fillStyle = muted;
    ctx.font = "600 52px Arial, sans-serif";
    drawWrappedText(ctx, config.headline || "Estimated result", left, y, contentWidth, 62);

    y += 180;
    ctx.fillStyle = text;
    ctx.font = "700 110px Arial, sans-serif";
    ctx.fillText(config.mainValue || "—", left, y);

    y += 100;
    ctx.fillStyle = muted;
    ctx.font = "500 40px Arial, sans-serif";
    drawWrappedText(ctx, config.subline || "", left, y, contentWidth, 50);

    if (config.contextLine) {
      y += 120;
      ctx.fillStyle = subtle;
      ctx.font = "400 34px Arial, sans-serif";
      drawWrappedText(ctx, config.contextLine, left, y, contentWidth, 44);
    }

    ctx.strokeStyle = "rgba(217,180,106,0.45)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left, HEIGHT - 220);
    ctx.lineTo(right, HEIGHT - 220);
    ctx.stroke();

    ctx.fillStyle = text;
    ctx.font = "600 36px Arial, sans-serif";
    drawWrappedText(
      ctx,
      config.footer || "Run your own numbers at TheLongMath.com",
      left,
      HEIGHT - 150,
      contentWidth,
      44
    );

    return canvas;
  }

  async function generateImageBlob(config) {
    var canvas = createShareCardCanvas(config);
    var blob = await canvasToBlob(canvas);
    track("calculator_result_image_generated", {
      calculator_name: config.calculatorName || "calculator",
    });
    return blob;
  }

  function getFilename(calculatorName) {
    var safe = String(calculatorName || "calculator").replace(/[^\w-]+/g, "-").toLowerCase();
    return "thelongmath-" + safe + "-result.png";
  }

  async function shareResultCard(config) {
    var blob = await generateImageBlob(config);
    var shareUrl = config.url || window.location.href;
    var payload = {
      title: config.title || "The Long Math calculator result",
      text: config.shareText || (config.headline ? config.headline + " - estimate based on assumptions." : "Calculator estimate"),
      url: shareUrl,
    };

    if (navigator.share) {
      var supportsFileShare = false;
      var file = null;
      if (typeof File === "function") {
        try {
          file = new File([blob], getFilename(config.calculatorName), { type: "image/png" });
          supportsFileShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
        } catch (_fileErr) {
          supportsFileShare = false;
          file = null;
        }
      }

      if (supportsFileShare) {
        try {
          await navigator.share({
            title: payload.title,
            text: payload.text,
            url: payload.url,
            files: [file],
          });
          track("calculator_result_native_share_succeeded", {
            calculator_name: config.calculatorName || "calculator",
            mode: "files_url_text",
          });
          return { mode: "native-share-files" };
        } catch (_err) {
          // Some share targets reject files+url/text combos. Fall through to URL/text share.
        }
      }

      try {
        await navigator.share({
          title: payload.title,
          text: payload.text,
          url: payload.url,
        });
        track("calculator_result_native_share_succeeded", {
          calculator_name: config.calculatorName || "calculator",
          mode: "url_text",
        });
        return { mode: "native-share-link" };
      } catch (_err2) {
        track("calculator_result_native_share_failed", {
          calculator_name: config.calculatorName || "calculator",
          mode: supportsFileShare ? "native-failed-after-file-fallback" : "native-failed",
        });
      }
    }

    triggerDownload(blob, getFilename(config.calculatorName));
    track("calculator_result_image_downloaded", {
      calculator_name: config.calculatorName || "calculator",
      mode: "share-fallback",
    });
    var copied = false;
    try {
      await copyText(shareUrl);
      copied = true;
      track("calculator_result_link_copied", {
        calculator_name: config.calculatorName || "calculator",
        mode: "share-fallback",
      });
    } catch (_copyErr) {
      copied = false;
    }
    return { mode: "download-and-copy-fallback", copied: copied };
  }

  async function downloadResultCard(config) {
    var blob = await generateImageBlob(config);
    triggerDownload(blob, getFilename(config.calculatorName));
    track("calculator_result_image_downloaded", {
      calculator_name: config.calculatorName || "calculator",
    });
  }

  async function copyResultLink(config) {
    await copyText(config.url || window.location.href);
    track("calculator_result_link_copied", {
      calculator_name: config.calculatorName || "calculator",
    });
  }

  window.TLM = window.TLM || {};
  window.TLM.shareCard = {
    createShareCardCanvas: createShareCardCanvas,
    shareResultCard: shareResultCard,
    downloadResultCard: downloadResultCard,
    copyResultLink: copyResultLink,
    buildResultUrl: buildResultUrl,
    track: track,
    isFiniteNumber: isFiniteNumber,
  };
})();
