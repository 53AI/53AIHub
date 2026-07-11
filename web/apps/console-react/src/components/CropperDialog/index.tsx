import { forwardRef } from "react";
import { CropperDialog as BaseCropperDialog, type CropperDialogRef, type CropperDialogProps } from "@km/shared-components-react";
import { t } from "@/locales";
import { api_host } from "@/utils/config";
import uploadApi from "@/api/modules/upload";

export type { CropperDialogRef, CropperDialogProps };

export const CropperDialog = forwardRef<CropperDialogRef, CropperDialogProps>(
  function CropperDialog(
    {
      title = t("common.image_cropper"),
      locale,
      ...props
    },
    ref
  ) {
    const handleUpload = async (file: File) => {
      const res = await uploadApi.upload(file);
      const url = `${api_host}/api/preview/${res.data?.preview_key || ""}`;
      return { url, preview_key: res.data?.preview_key };
    };

    const defaultLocale = {
      imageValidator: t("form.image_validator"),
      sizeLimit: t("file.size_limit"),
      uploadFailed: t("action.save_failed"),
      cancel: t("action.cancel"),
      reset: t("action.reset"),
      confirm: t("action.confirm"),
      reupload: t("action.reupload"),
      preview: t("action.preview"),
    };

    return (
      <BaseCropperDialog
        ref={ref}
        title={title}
        onUpload={handleUpload}
        locale={{ ...defaultLocale, ...locale }}
        {...props}
      />
    );
  }
);

CropperDialog.displayName = "CropperDialog";

export default CropperDialog;