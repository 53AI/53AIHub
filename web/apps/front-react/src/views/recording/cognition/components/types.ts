import type {
  RecordingCognitionLayer,
  RecordingCognitionCanonicalType,
} from '@/api/modules/recording/types';

export type DrawerScope =
  | { kind: 'core'; key: RecordingCognitionCanonicalType; label: string; hint: string }
  | { kind: 'situational'; code: string; id: string; label: string; hint: string }

export type EditorDraft = {
  title: string
  statement: string
  cognitionType: RecordingCognitionCanonicalType | ''
  layer: RecordingCognitionLayer
  domainId: string
}

export type ImportDraft = {
  title: string
  statement: string
  canonicalType: RecordingCognitionCanonicalType
  layer: RecordingCognitionLayer
  scope: string
  externalSource: string
  externalRef: string
}

export type DomainCreateDraft = {
  name: string
  logo?: string
  description?: string
}