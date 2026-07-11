import React from "react";
import Icon from "../../Icon/index.tsx";
import Tooltip from "../../Tooltip";
import { t } from "../../../locale";
import "./code.css";

interface CodeProps {
  html: string;
  value: string;
  language?: string;
  onCopy?: (value: string) => void;
}

const Code: React.FC<CodeProps> = ({ html, value, language = "", onCopy }) => {
  return (
    <div className="x-code-diagram-viewer">
      <div className="x-code-diagram-viewer__header">
        <div className="x-code-diagram-viewer__tabs-container">
          {language && (
            <div className="x-code-diagram-viewer__tabs">
              <div className="x-code-diagram-viewer__tab x-code-diagram-viewer__tab--active">
                {language.toUpperCase()}
              </div>
            </div>
          )}
        </div>
        <div className="x-code-diagram-viewer__actions">
          <Tooltip
            content={t("hubx.bubble.copy")}
            placement="top"
            trigger="hover"
          >
            <i
              className="x-code-diagram-viewer__icon"
              onClick={() => onCopy?.(value)}
            >
              <Icon size="18px" name="copy" />
            </i>
          </Tooltip>
        </div>
      </div>
      <div className="x-code-diagram-viewer__content">
        <div className="x-code-diagram-viewer__code">
          <pre
            className="x-code-diagram-viewer__code-pre"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>
    </div>
  );
};

Code.displayName = "XMarkdownCode";

export default Code;
