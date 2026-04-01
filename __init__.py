from .nodes import AutoMask

NODE_CLASS_MAPPINGS = {
    "AutoMask": AutoMask,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AutoMask": "Auto Mask (IMGLAB)",
}

WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
