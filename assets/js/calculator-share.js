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

  function drawRoundedRect(ctx, x, y, width, height, radius) {
    var r = Math.max(0, Math.min(radius || 0, Math.min(width, height) / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
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
    var accentBlue = "#4da3ff";
    var accentBlueSoft = "rgba(77,163,255,0.24)";
    var accentBluePanel = "rgba(77,163,255,0.11)";
    var text = "#eef2f7";
    var muted = "rgba(238,242,247,0.82)";
    var subtle = "rgba(238,242,247,0.62)";

    var grad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    grad.addColorStop(0, bgTop);
    grad.addColorStop(1, bgBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Add subtle blue energy in the background so cards look less flat in social feeds.
    var glow = ctx.createRadialGradient(WIDTH * 0.5, 350, 40, WIDTH * 0.5, 350, 520);
    glow.addColorStop(0, "rgba(77,163,255,0.24)");
    glow.addColorStop(1, "rgba(77,163,255,0)");
    ctx.fillStyle = glow;
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
    // Highlight the main value with a blue panel + glow for stronger visual punch.
    var mainValue = String(config.mainValue || "—");
    ctx.font = "700 110px Arial, sans-serif";
    var mvWidth = ctx.measureText(mainValue).width;
    var badgeX = left - 20;
    var badgeY = y - 112;
    var badgeW = Math.min(contentWidth, mvWidth + 40);
    var badgeH = 132;
    ctx.shadowColor = "rgba(77,163,255,0.34)";
    ctx.shadowBlur = 26;
    ctx.fillStyle = accentBluePanel;
    drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 20);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = accentBlueSoft;
    ctx.lineWidth = 2;
    drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 20);
    ctx.stroke();

    ctx.fillStyle = text;
    ctx.font = "700 110px Arial, sans-serif";
    ctx.fillText(mainValue, left, y);

    // Thin blue accent bar under the number panel.
    ctx.fillStyle = accentBlue;
    drawRoundedRect(ctx, badgeX, badgeY + badgeH + 10, Math.min(220, badgeW), 7, 4);
    ctx.fill();

    y += 100;
    ctx.fillStyle = muted;
    ctx.font = "500 40px Arial, sans-serif";
    drawWrappedText(ctx, config.subline || "", left, y, contentWidth, 50);

    if (Array.isArray(config.contextLines) && config.contextLines.length) {
      y += 120;
      ctx.fillStyle = subtle;
      ctx.font = "400 34px Arial, sans-serif";
      for (var cl = 0; cl < config.contextLines.length; cl += 1) {
        var line = String(config.contextLines[cl] || "").trim();
        if (!line) continue;
        y += drawWrappedText(ctx, line, left, y, contentWidth, 44) * 44;
        y += 10;
      }
    } else if (config.contextLine) {
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

  function setShareStatusEl(statusId, message, isError) {
    var el = document.getElementById(statusId || "result_share_status");
    if (!el) return;
    el.textContent = message || "";
    el.style.color = isError ? "#e7b4b4" : "";
  }

  /**
   * Generic wiring for Share image / Download PNG / Copy result link on calculator pages.
   * getBundle: () => { scenario: object for query URL, card: { headline, mainValue, subline, contextLine, shareText, title } }
   */
  function wireCalculatorShare(slug, getBundle, opts) {
    opts = opts || {};
    var statusId = opts.statusElementId || "result_share_status";

    if (!slug || typeof getBundle !== "function") return;
    if (!document.getElementById(opts.shareBtnId || "share_result_btn")) return;

    function buildPayload() {
      var b = getBundle();
      if (!b || !b.scenario || !b.card) return null;
      var url = buildResultUrl(window.location.href, b.scenario);
      var c = b.card;
      return {
        calculatorName: slug,
        title: c.title || "The Long Math calculator result",
        headline: c.headline,
        mainValue: c.mainValue,
        subline: c.subline,
        contextLine: c.contextLine,
        contextLines: c.contextLines,
        footer: "Run your own numbers at TheLongMath.com",
        shareText: c.shareText,
        url: url,
      };
    }

    var shareBtn = document.getElementById(opts.shareBtnId || "share_result_btn");
    var downloadBtn = document.getElementById(opts.downloadBtnId || "download_result_btn");
    var copyBtn = document.getElementById(opts.copyBtnId || "copy_result_link_btn");

    if (shareBtn) {
      shareBtn.addEventListener("click", async function () {
        var p = buildPayload();
        if (!p) return;
        setShareStatusEl(statusId, "Preparing image...");
        track("calculator_result_share_clicked", { calculator_name: slug });
        try {
          var result = await shareResultCard(p);
          if (result && result.mode === "download-and-copy-fallback") {
            if (result.copied) {
              setShareStatusEl(statusId, "Shared via fallback: PNG opened/downloaded and scenario link copied.");
            } else {
              setShareStatusEl(statusId, "PNG opened/downloaded. Copy result link manually if needed.");
            }
          } else if (result && result.mode === "native-share-link") {
            setShareStatusEl(statusId, "Share dialog opened with result summary and scenario link.");
          } else {
            setShareStatusEl(statusId, "Share dialog opened with image, summary, and scenario link.");
          }
        } catch (_err) {
          setShareStatusEl(statusId, "Share cancelled or unavailable. Try Download PNG instead.", true);
        }
      });
    }

    if (downloadBtn) {
      downloadBtn.addEventListener("click", async function () {
        var p = buildPayload();
        if (!p) return;
        setShareStatusEl(statusId, "Generating PNG...");
        try {
          await downloadResultCard(p);
          setShareStatusEl(statusId, "PNG downloaded.");
        } catch (_e) {
          setShareStatusEl(statusId, "Could not generate PNG. Please try again.", true);
        }
      });
    }

    if (copyBtn) {
      copyBtn.addEventListener("click", async function () {
        var p = buildPayload();
        if (!p) return;
        try {
          await copyResultLink(p);
          setShareStatusEl(statusId, "Result link copied.");
        } catch (_e) {
          setShareStatusEl(statusId, "Could not copy link on this browser.", true);
        }
      });
    }
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
    wireCalculatorShare: wireCalculatorShare,
  };
})();
