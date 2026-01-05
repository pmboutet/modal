"use client";

import React, { useEffect, useRef } from "react";
import { Textarea, TextareaProps } from "./textarea";

/**
 * Auto-resize textarea that adjusts height based on content
 * Wraps the base Textarea component with auto-resize functionality
 */
const AutoResizeTextarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ value, onChange, style, ...props }, ref) => {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    const combinedRef = (node: HTMLTextAreaElement | null) => {
      if (typeof ref === "function") {
        ref(node);
      } else if (ref && typeof ref === "object" && "current" in ref) {
        (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
      }
      textareaRef.current = node;
    };

    // Resize on value change
    useEffect(() => {
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.style.height = "auto";
        textarea.style.height = `${textarea.scrollHeight}px`;
      }
    }, [value]);

    // Resize on mount
    useEffect(() => {
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.style.height = "auto";
        textarea.style.height = `${textarea.scrollHeight}px`;
      }
    }, []);

    return (
      <Textarea
        ref={combinedRef}
        value={value}
        onChange={onChange}
        {...props}
        style={{ overflow: "hidden", resize: "none", ...style }}
      />
    );
  }
);
AutoResizeTextarea.displayName = "AutoResizeTextarea";

export { AutoResizeTextarea };
