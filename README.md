# ComfyUI-AutoPickMask (IMGLAB)

A ComfyUI custom node that accepts one image and up to 8 mask inputs, compares dimensions, and outputs the first matching mask — with configurable edge-case handling and an optional fallback (else) mask.

## Installation

Drop the `ComfyUI-AutoPickMask/` folder into `ComfyUI/custom_nodes/` and restart ComfyUI.

```
ComfyUI/
└── custom_nodes/
    └── ComfyUI-AutoPickMask/
        ├── __init__.py
        ├── nodes.py
        ├── README.md
        └── js/
            └── auto_pick_mask.js
```

## Inputs

| Input | Type | Description |
|---|---|---|
| `image` | IMAGE | Source image — defines the target resolution |
| `on_multi_match` | combo | Behaviour when multiple masks match the image size |
| `on_no_match` | combo | Behaviour when no mask matches the image size |
| `mask_1` … `mask_8` | MASK | Dynamic slots — next slot appears as each one is connected |
| `else_mask` | MASK | Fallback mask — only visible when `on_no_match = Use Else Mask` |

## Outputs

| Output | Type | Description |
|---|---|---|
| `image` | IMAGE | Direct passthrough of the input image |
| `matched_mask` | MASK | First mask whose dimensions match the image (or fallback) |
| `rgba` | IMAGE | Input image with matched mask as alpha channel `[B,H,W,4]` |

## Edge Case Options

### on_multi_match — when 2+ masks share the image's exact dimensions:
| Option | Behaviour |
|---|---|
| `Use First (Top Priority)` | Silently picks the lowest-numbered slot |
| `Raise Error` | Halts the queue listing the conflicting slot numbers |

### on_no_match — when no connected mask matches the image size:
| Option | Behaviour |
|---|---|
| `Output Empty Mask` | Outputs a zeroed mask (RGBA will be fully transparent) |
| `Use Else Mask` | Reveals an `else_mask` input slot; uses it as the fallback output |
| `Raise Error` | Halts the queue listing the sizes that were connected |

> **Note:** If `Use Else Mask` is selected but `else_mask` is not connected, the node will raise an error rather than silently fail.

## Node UI

- **Image slot** — shows resolution (`W×H`) in grey after execution
- **Mask slots** — show resolution coloured green (match) or red (mismatch); unconnected slots show a faint grey dot
- **Else mask slot** — shows a `fallback` label in amber; only visible when `on_no_match = Use Else Mask`
- Mask slots expand automatically as you connect them (up to 8), and collapse when disconnected
