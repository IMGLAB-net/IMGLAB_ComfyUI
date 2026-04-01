import { app } from "../../scripts/app.js";

const MAX_MASKS  = 8;
const MASK_TYPE  = "MASK";
const RES_COLOR  = "#aaaaaa";
const OK_COLOR   = "#22cc66";
const ERR_COLOR  = "#cc3333";
const NA_COLOR   = "#555555";
const ELSE_COLOR = "#cc9900";

const SLOT_FONT   = "12px Arial";
const SLOT_NAME_X = 14;
const DOT_RADIUS  = 5;
const NAME_GAP    = 12;   // gap: end of slot name → dot centre
const DOT_GAP     = 10;   // gap: dot right edge → resolution text left edge

// LiteGraph draws output labels right-aligned from nodeW-10.
// Our widest output name is "mask" or "rgba" (~30px in 12px Arial).
// We leave 14px extra buffer, so output area = nodeW - 10 - 30 - 14 = nodeW - 54.
// Resolution text right edge must stay at or left of this boundary.
const OUTPUT_LABEL_RESERVE = 54;

const HELP_SECTIONS = [
    {
        title: "Inputs",
        items: [
            ["image",     "Defines the target resolution for matching."],
            ["mask_1..8", "Connect as many masks as needed. A new slot appears as each one is connected."],
            ["else",      "Fallback mask. Visible only when no_match is set to Use Else Mask."],
        ]
    },
    {
        title: "Matching",
        items: [
            ["✓ green",  "Mask dimensions match the image exactly."],
            ["✗ red",    "Mask dimensions do not match."],
            ["priority", "The lowest-numbered matching slot always wins."],
        ]
    },
    {
        title: "multi_match",
        items: [
            ["Use First Match", "Silently picks the lowest matching slot."],
            ["Raise Error",     "Halts the queue and lists the conflicting slot numbers."],
        ]
    },
    {
        title: "no_match",
        items: [
            ["Output Empty Mask", "Outputs a zeroed mask (RGBA will be fully transparent)."],
            ["Use Else Mask",     "Uses the else input as the fallback output."],
            ["Raise Error",       "Halts the queue and lists the sizes that were connected."],
        ]
    },
    {
        title: "Outputs",
        items: [
            ["image", "Direct passthrough of the input image."],
            ["mask",  "The winning mask (or fallback)."],
            ["rgba",  "Input image + matched mask as alpha channel [B,H,W,4]."],
        ]
    },
];

const HELP_BTN_W = 16;
const HELP_BTN_H = 14;
const HELP_BTN_R = 6;

let _helpPanel = null;

function getHelpPanel() {
    if (_helpPanel) return _helpPanel;
    const panel = document.createElement("div");
    Object.assign(panel.style, {
        position: "fixed", zIndex: "9999", background: "#1a1a2e",
        border: "1px solid rgba(255,255,255,0.2)", borderRadius: "8px",
        padding: "14px 16px", width: "300px", maxHeight: "420px",
        overflowY: "auto", boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        color: "#ddd", fontFamily: "sans-serif", fontSize: "12px",
        lineHeight: "1.5", display: "none", userSelect: "none",
    });
    let html = `<div style="font-size:13px;font-weight:bold;color:#fff;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.15)">
        AUTO MASK <span style="color:#a78bfa">(IMGLAB)</span>
        <span style="font-size:10px;color:#888;font-weight:normal;margin-left:6px">How it works</span>
        <span id="apm-help-close" style="float:right;cursor:pointer;color:#888;font-size:14px;line-height:1">✕</span>
    </div>`;
    for (const section of HELP_SECTIONS) {
        html += `<div style="margin-top:10px;margin-bottom:4px;font-size:11px;font-weight:bold;color:#8ab4f8;text-transform:uppercase;letter-spacing:0.05em">${section.title}</div>`;
        html += `<table style="width:100%;border-collapse:collapse">`;
        for (const [key, val] of section.items)
            html += `<tr><td style="color:#f0c040;white-space:nowrap;padding:2px 8px 2px 0;vertical-align:top;min-width:110px">${key}</td><td style="color:#ccc;padding:2px 0;vertical-align:top">${val}</td></tr>`;
        html += `</table>`;
    }
    panel.innerHTML = html;
    document.body.appendChild(panel);
    panel.querySelector("#apm-help-close").addEventListener("click", () => panel.style.display = "none");
    document.addEventListener("mousedown", (e) => {
        if (panel.style.display !== "none" && !panel.contains(e.target)) panel.style.display = "none";
    }, true);
    _helpPanel = panel;
    return panel;
}

function showHelpNear(sx, sy, sw) {
    const panel = getHelpPanel();
    panel.style.display = "block";
    const pw = panel.offsetWidth || 300, ph = panel.offsetHeight || 400;
    const vw = window.innerWidth, vh = window.innerHeight;
    let x = sx + sw + 10;
    if (x + pw > vw - 10) x = sx - pw - 10;
    let y = sy;
    if (y + ph > vh - 10) y = vh - ph - 10;
    if (y < 10) y = 10;
    panel.style.left = `${x}px`;
    panel.style.top  = `${y}px`;
}

app.registerExtension({
    name: "IMGLAB.AutoMask",

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "AutoMask") return;

        const origCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origCreated?.apply(this, arguments);
            // Default node colour — purple theme
            if (!this.color)    this.color   = "#2d1a4a";  // header — dark purple
            if (!this.bgcolor)  this.bgcolor = "#4a2878";  // body — original purple
            this._am_matchResults = {};
            this._am_imageSize    = null;
            this._am_maskSizes    = {};
            this._am_elseMaskSize = null;
            for (let i = this.inputs.length - 1; i >= 0; i--) {
                const n = this.inputs[i].name;
                if (/^mask_[2-9]$/.test(n) || /^mask_\d{2,}$/.test(n) || n === "else")
                    this.removeInput(i);
            }
            this._am_watchNoMatchWidget();
        };

        nodeType.prototype._am_watchNoMatchWidget = function () {
            const widget = this.widgets?.find(w => w.name === "no_match");
            if (!widget) return;
            const self = this;
            const orig = widget.callback;
            widget.callback = function (v) { orig?.call(this, v); self._am_syncElseSlot(v); };
            this._am_syncElseSlot(widget.value);
        };

        nodeType.prototype._am_syncElseSlot = function (value) {
            const hasElse = this.inputs.some(i => i.name === "else");
            if (value === "Use Else Mask" && !hasElse) {
                this.addInput("else", MASK_TYPE);
                this.setSize(this.computeSize());
            } else if (value !== "Use Else Mask" && hasElse) {
                const idx = this.inputs.findIndex(i => i.name === "else");
                if (idx >= 0) { this.removeInput(idx); this.setSize(this.computeSize()); }
            }
            this.setDirtyCanvas(true, true);
        };

        nodeType.prototype._am_getMaskInputs = function () {
            return this.inputs
                .map((inp, idx) => ({ ...inp, _idx: idx }))
                .filter(inp => /^mask_\d+$/.test(inp.name))
                .sort((a, b) => parseInt(a.name.split("_")[1]) - parseInt(b.name.split("_")[1]));
        };

        nodeType.prototype._am_updateDynamicInputs = function () {
            const masks = this._am_getMaskInputs();
            let lastConnected = -1;
            for (let i = 0; i < masks.length; i++) if (masks[i].link != null) lastConnected = i;
            const targetCount = Math.min(lastConnected + 2, MAX_MASKS);
            for (let n = masks.length + 1; n <= targetCount; n++) this.addInput(`mask_${n}`, MASK_TYPE);
            const updated = this._am_getMaskInputs();
            for (let i = updated.length - 1; i >= targetCount; i--) {
                const gIdx = this.inputs.findIndex(inp => inp.name === updated[i].name);
                if (gIdx >= 0 && updated[i].link == null) this.removeInput(gIdx);
            }
            // Keep else at the bottom
            const elseIdx = this.inputs.findIndex(inp => inp.name === "else");
            if (elseIdx >= 0 && elseIdx !== this.inputs.length - 1) {
                this.removeInput(elseIdx);
                this.addInput("else", MASK_TYPE);
            }
            this.setSize(this.computeSize());
        };

        nodeType.prototype.onConnectionsChange = function (type, slotIndex, connected, link_info, input) {
            if (type !== 1) return;
            this._am_updateDynamicInputs();
            this.setDirtyCanvas(true, true);
        };

        nodeType.prototype.onExecuted = function (message) {
            if (message?.match_results?.[0]) {
                const raw = message.match_results[0];
                this._am_matchResults = {};
                for (const k in raw) this._am_matchResults[parseInt(k)] = raw[k];
            }
            if (message?.image_size?.[0])   this._am_imageSize = message.image_size[0];
            if (message?.mask_sizes?.[0]) {
                const raw = message.mask_sizes[0];
                this._am_maskSizes = {};
                for (const k in raw) this._am_maskSizes[parseInt(k)] = raw[k];
            }
            this._am_elseMaskSize = message?.else_mask_size?.[0] ?? null;
            this.setDirtyCanvas(true, true);
        };

        nodeType.prototype._am_helpBtnRect = function () {
            const titleH = LiteGraph.NODE_TITLE_HEIGHT;
            return {
                x: this.size[0] - HELP_BTN_R - HELP_BTN_W,
                y: -titleH + (titleH - HELP_BTN_H) / 2,
                w: HELP_BTN_W, h: HELP_BTN_H,
            };
        };

        const origDrawFg = nodeType.prototype.onDrawForeground;
        nodeType.prototype.onDrawForeground = function (ctx) {
            origDrawFg?.apply(this, arguments);

            // ? button
            const btn = this._am_helpBtnRect();
            ctx.beginPath(); ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 4);
            ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fill();
            ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.lineWidth = 1; ctx.stroke();
            ctx.font = "bold 11px sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.75)";
            ctx.textAlign = "center";
            ctx.fillText("?", btn.x + btn.w / 2, btn.y + btn.h - 3);

            if (this.flags?.collapsed) return;

            const matchResults = this._am_matchResults || {};
            const maskSizes    = this._am_maskSizes    || {};
            const imageSize    = this._am_imageSize;
            const elseMaskSize = this._am_elseMaskSize;
            const nodeW        = this.size[0];

            // Compute shared dot column from widest mask_N name only.
            // image and else are shorter and would misalign the column.
            ctx.font = SLOT_FONT;
            let maxMaskNameW = ctx.measureText("mask_1").width; // minimum
            for (const inp of this.inputs) {
                if (/^mask_\d+$/.test(inp.name)) {
                    const w = ctx.measureText(inp.name).width;
                    if (w > maxMaskNameW) maxMaskNameW = w;
                }
            }
            const dotX = SLOT_NAME_X + maxMaskNameW + NAME_GAP + DOT_RADIUS;

            // Resolution text is right-aligned to just before the output label area.
            // Output labels ("image","mask","rgba") are at the right side of the node.
            // We reserve OUTPUT_LABEL_RESERVE px from the right for them.
            const resRight = nodeW - OUTPUT_LABEL_RESERVE;
			const dimX = dotX+DOT_GAP;
			
            const drawDot = (cx, cy, color, symbol) => {
                ctx.beginPath();
                ctx.arc(cx, cy, DOT_RADIUS, 0, Math.PI * 2);
                ctx.fillStyle = color; ctx.fill();
                if (symbol) {
                    ctx.font = "bold 8px sans-serif"; ctx.fillStyle = "#fff";
                    ctx.textAlign = "center";
                    ctx.fillText(symbol, cx, cy + 3);
                }
            };

            const drawRes = (text, cy, color) => {
                ctx.font = "11px monospace"; ctx.fillStyle = color;
                ctx.textAlign = "left";
                ctx.fillText(text, dimX, cy + 4);
            };

            for (let i = 0; i < this.inputs.length; i++) {
                const inp       = this.inputs[i];
                const canvasPos = this.getConnectionPos(true, i);
                const cy        = canvasPos[1] - this.pos[1];

                // ── image ────────────────────────────────────────────────
                if (inp.name === "image") {
                    if (imageSize) drawRes(`${imageSize[0]}×${imageSize[1]}`, cy, RES_COLOR);
                    continue;
                }

                // ── else ─────────────────────────────────────────────────
                if (inp.name === "else") {
                    ctx.font = SLOT_FONT;
                    const elseNameW = ctx.measureText("else").width;
                    const elseDotX  = SLOT_NAME_X + elseNameW + NAME_GAP + DOT_RADIUS;
                    const connected = inp.link != null;
                    drawDot(dotX, cy, connected ? ELSE_COLOR : NA_COLOR, connected && elseMaskSize ? "~" : null);
                    if (connected && elseMaskSize) drawRes(`${elseMaskSize[0]}×${elseMaskSize[1]}`, cy, ELSE_COLOR);
                    continue;
                }

                if (!/^mask_\d+$/.test(inp.name)) continue;

                const num       = parseInt(inp.name.split("_")[1]);
                const connected = inp.link != null;
                const hasResult = num in matchResults;
                const hasMaskSz = num in maskSizes;

                // dot at shared column
                if (connected && hasResult) {
                    const isMatch = matchResults[num];
                    drawDot(dotX, cy, isMatch ? OK_COLOR : ERR_COLOR, isMatch ? "✓" : "✗");
                } else if (!connected) {
                    ctx.beginPath();
                    ctx.arc(dotX, cy, DOT_RADIUS - 1, 0, Math.PI * 2);
                    ctx.fillStyle = NA_COLOR; ctx.fill();
                }

                // resolution right-aligned before output labels
                if (connected && hasMaskSz) {
                    const [mw, mh] = maskSizes[num];
                    const isMatch  = hasResult ? matchResults[num] : null;
                    drawRes(`${mw}×${mh}`, cy,
                        isMatch === true ? OK_COLOR : isMatch === false ? ERR_COLOR : RES_COLOR);
                }
            }
        };

        const origMouseDown = nodeType.prototype.onMouseDown;
        nodeType.prototype.onMouseDown = function (e, localPos, graphCanvas) {
            const btn = this._am_helpBtnRect();
            const [mx, my] = localPos;
            if (mx >= btn.x && mx <= btn.x + btn.w && my >= btn.y && my <= btn.y + btn.h) {
                const canvas = graphCanvas.canvas, rect = canvas.getBoundingClientRect();
                const scale = graphCanvas.ds?.scale ?? 1, offset = graphCanvas.ds?.offset ?? [0, 0];
                showHelpNear(
                    rect.left + (this.pos[0] + offset[0]) * scale,
                    rect.top  + (this.pos[1] + offset[1]) * scale,
                    this.size[0] * scale
                );
                return true;
            }
            return origMouseDown?.call(this, e, localPos, graphCanvas);
        };
    },
});
