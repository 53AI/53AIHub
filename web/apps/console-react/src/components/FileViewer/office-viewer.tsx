interface OfficeViewerProps {
  url: string
}

export function OfficeViewer({ url }: OfficeViewerProps) {
  return (
    <iframe
      src={`/office-viewer.html?url=${url}`}
      className="w-full h-full border-0"
      title="Office Viewer"
    />
  )
}

export default OfficeViewer