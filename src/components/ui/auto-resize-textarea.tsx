"use client";

import React, { useEffect, useRef, useState } from "react";
import { Textarea, TextareaProps } from "./textarea";

interface AutoResizeTextareaProps extends TextareaProps {
  /** Maximum height as CSS value (e.g., "30vh", "200px") */
  maxHeight?: string;
  /** Minimum height as CSS value (e.g., "60px") */
  minHeight?: string;
}

/**
 * Auto-resize textarea that adjusts height based on content
 * Wraps the base Textarea component with auto-resize functionality
 * Supports maxHeight to limit growth (useful for chat inputs)
 */
const AutoResizeTextarea = React.forwardRef<HTMLTextAreaElement, AutoResizeTextareaProps>(
  ({ value, onChange, style, maxHeight, minHeight = "60px", ...props }, ref) => {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const [shouldScroll, setShouldScroll] = useState(false);

    const combinedRef = (node: HTMLTextAreaElement | null) => {
      if (typeof ref === "function") {
        ref(node);
      } else if (ref && typeof ref === "object" && "current" in ref) {
        (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
      }
      textareaRef.current = node;
    };

    // Calculate max height in pixels from CSS value
    const getMaxHeightPx = (): number | null => {
      if (!maxHeight) return null;

      if (maxHeight.endsWith("vh")) {
        const vh = parseFloat(maxHeight);
        return (vh / 100) * window.innerHeight;
      }
      if (maxHeight.endsWith("px")) {
        return parseFloat(maxHeight);
      }
      return null;
    };

    // Resize on value change
    useEffect(() => {
      const textarea = textareaRef.current;
      if (textarea) {
        // Reset height to auto to measure scrollHeight correctly
        textarea.style.height = "auto";

        const scrollHeight = textarea.scrollHeight;
        const maxHeightPx = getMaxHeightPx();

        if (maxHeightPx && scrollHeight > maxHeightPx) {
          textarea.style.height = `${maxHeightPx}px`;
          setShouldScroll(true);
        } else {
          textarea.style.height = `${scrollHeight}px`;
          setShouldScroll(false);
        }
      }
    }, [value, maxHeight]);

    // Resize on mount
    useEffect(() => {
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.style.height = "auto";

        const scrollHeight = textarea.scrollHeight;
        const maxHeightPx = getMaxHeightPx();

        if (maxHeightPx && scrollHeight > maxHeightPx) {
          textarea.style.height = `${maxHeightPx}px`;
          setShouldScroll(true);
        } else {
          textarea.style.height = `${scrollHeight}px`;
          setShouldScroll(false);
        }
      }
    }, []);

    return (
      <Textarea
        ref={combinedRef}
        value={value}
        onChange={onChange}
        {...props}
        style={{
          overflow: shouldScroll ? "auto" : "hidden",
          resize: "none",
          minHeight,
          ...style
        }}
      />
    );
  }
);
AutoResizeTextarea.displayName = "AutoResizeTextarea";

export { AutoResizeTextarea };
