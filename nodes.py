import torch

MAX_MASKS = 8


class AutoMask:
    @classmethod
    def INPUT_TYPES(cls):
        optional = {f"mask_{i}": ("MASK",) for i in range(1, MAX_MASKS + 1)}
        optional["else"] = ("MASK",)
        return {
            "required": {
                "image": ("IMAGE",),
                "multi_match": (["Use First Match", "Raise Error"],),
                "no_match":    (["Output Empty Mask", "Use Else Mask", "Raise Error"],),
            },
            "optional": optional,
        }

    RETURN_TYPES  = ("IMAGE", "MASK",  "IMAGE")
    RETURN_NAMES  = ("image", "mask",  "rgba")
    FUNCTION      = "execute"
    CATEGORY      = "IMGLAB"

    def execute(self, image, multi_match, no_match, **kwargs):
        B, img_h, img_w, C = image.shape

        match_results = {}
        mask_sizes    = {}
        matched_masks = []

        for i in range(1, MAX_MASKS + 1):
            mask = kwargs.get(f"mask_{i}")
            if mask is None:
                continue

            if mask.dim() == 2:
                mh, mw = mask.shape
                mask = mask.unsqueeze(0).expand(B, -1, -1)
            elif mask.dim() == 3:
                mh, mw = mask.shape[1], mask.shape[2]
                if mask.shape[0] != B:
                    mask = mask.expand(B, -1, -1)
            else:
                match_results[i] = False
                continue

            mask_sizes[i] = [mw, mh]
            is_match = (mh == img_h and mw == img_w)
            match_results[i] = is_match

            if is_match:
                matched_masks.append((i, mask))

        # ── else mask size for UI display ────────────────────────────────
        else_mask_size = None
        else_mask_raw  = kwargs.get("else")
        if else_mask_raw is not None:
            if else_mask_raw.dim() == 2:
                emh, emw = else_mask_raw.shape
            elif else_mask_raw.dim() == 3:
                emh, emw = else_mask_raw.shape[1], else_mask_raw.shape[2]
            else:
                emh, emw = 0, 0
            else_mask_size = [emw, emh]

        # ── Multiple matches ─────────────────────────────────────────────
        if len(matched_masks) > 1 and multi_match == "Raise Error":
            slots = [str(s) for s, _ in matched_masks]
            raise ValueError(
                f"[AutoPickMask] Multiple masks match {img_w}×{img_h}: "
                f"slots {', '.join(slots)}. "
                f"Disconnect duplicates or switch to 'Use First Match'."
            )

        # ── No match ─────────────────────────────────────────────────────
        if len(matched_masks) == 0:
            if no_match == "Raise Error":
                connected = [str(k) for k in mask_sizes]
                raise ValueError(
                    f"[AutoPickMask] No mask matches {img_w}×{img_h}. "
                    f"Connected slots: {', '.join(connected) or 'none'}."
                )
            elif no_match == "Use Else Mask":
                else_mask = else_mask_raw
                if else_mask is None:
                    raise ValueError(
                        f"[AutoPickMask] No mask matches {img_w}×{img_h} and "
                        f"'else' is not connected. Connect an else mask or "
                        f"change 'no_match' to 'Output Empty Mask'."
                    )
                if else_mask.dim() == 2:
                    else_mask = else_mask.unsqueeze(0).expand(B, -1, -1)
                elif else_mask.dim() == 3:
                    if else_mask.shape[0] != B:
                        else_mask = else_mask.expand(B, -1, -1)
                matched_mask = else_mask
            else:
                matched_mask = torch.zeros(
                    B, img_h, img_w, dtype=image.dtype, device=image.device
                )
        else:
            matched_mask = matched_masks[0][1]

        # ── Resize if needed (else mask may differ in size) ──────────────
        mh, mw = matched_mask.shape[1], matched_mask.shape[2]
        if mh != img_h or mw != img_w:
            import torch.nn.functional as F
            matched_mask = F.interpolate(
                matched_mask.unsqueeze(1).float(),
                size=(img_h, img_w),
                mode="nearest"
            ).squeeze(1).to(image.dtype)

        alpha = matched_mask.unsqueeze(-1)
        rgba  = torch.cat([image, alpha], dim=-1)

        return {
            "result": (image, matched_mask, rgba),
            "ui": {
                "match_results":  [match_results],
                "image_size":     [[img_w, img_h]],
                "mask_sizes":     [mask_sizes],
                "else_mask_size": [else_mask_size] if else_mask_size else [],
            },
        }
