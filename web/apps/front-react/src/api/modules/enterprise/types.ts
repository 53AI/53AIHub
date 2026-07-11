export interface RawEnterpriseInfo {
  "enterprise": {
    "id": number,
    "display_name": string,
    "logo": string,
    "ico": string,
    "keywords": string,
    "copyright": string,
    "type": string,
    "banner": string,
    "language": string,
    "timezone": string,
    "domain": string,
    "slogan": string,
    "status": number,
    "description": string,
    "template_type": string,
    "layout_type": string,
    "wecom_corp_id": string,
    "wecom_install_info": {
      "install_wecom_app": number,
      "auth_corp_info": null
    },
    "created_time": number,
    "updated_time": number
  },
  "apply_info": {
    "apply_id": number,
    "user_id": number,
    "phone": string,
    "email": string,
    "enterprise_name": string,
    "contact_name": string,
    "status": number,
    "reason": string,
    "version": number,
    "expired_time": number,
    "eid": number,
    "created_time": number,
    "updated_time": number
  },
  "domains": [
    {
      "id": number,
      "eid": number,
      "domain": string,
      "type": number,
      "config": string,
      "created_time": number,
      "updated_time": number
    }
  ]
}

export interface FormatEnterpriseInfo {
  "eid": string,
  "logo": string,
  "description": string,
  "domain": string,
  "apply_id": number,
  "apply_name": string,
  "name": string,
  "is_process": boolean,
  "is_reject": boolean,
  "reject_reason": string,
  "expired_time": number,
  "is_expired": boolean,
  "created_time": number,
  "version": number,
  "version_name": string,
  "is_loading": boolean,
  "is_independent": boolean,
  "is_enterprise": boolean,
  "is_industry": boolean,
  "is_install_wecom": boolean,
  "wecom_info": {},
  "is_admin": boolean,
}

export interface EnterpriseListParams {
  status: -1 | 0 | 1 | 2,  //  (-1 for all) 0:待审核 1:已通过 2:已拒绝
  offset?: number,
  limit?: number
}

export interface EnterpriseList {
  count: number,
  details: RawEnterpriseInfo[]
}

export interface EnterpriseDetail {
  access_token: '',
  enterprise: {}
}
export interface EnterpriseFeature {
  feature_key: string
  value: boolean | number
}

export type EnterpriseFeatures = EnterpriseFeature[]
