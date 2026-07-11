import { forwardRef, useImperativeHandle, useRef } from "react";
import { MarkdownEditor, MarkdownEditorRef, MarkdownEditorProps } from "./editor";

export interface MarkdownEditorFieldProps extends Omit<MarkdownEditorProps, "value" | "onChange"> {
  value?: string;
  onChange?: (value: string) => void;
}

export type MarkdownEditorFieldRef = MarkdownEditorRef;

export const MarkdownEditorField = forwardRef<MarkdownEditorFieldRef, MarkdownEditorFieldProps>(
  ({ value, onChange, ...props }, ref) => {
    const editorRef = useRef<MarkdownEditorRef>(null);

    useImperativeHandle(ref, () => ({
      getValue: () => editorRef.current?.getValue() || "",
      setValue: (val) => editorRef.current?.setValue(val),
      focus: () => editorRef.current?.focus(),
    }));

    return (
      <MarkdownEditor
        ref={editorRef}
        value={value}
        onChange={onChange}
        {...props}
      />
    );
  }
);

MarkdownEditorField.displayName = "MarkdownEditorField";

export default MarkdownEditorField;