import type { Candidate, PageReview, Rights } from './model';

export const OFFICIAL_CONDITION_SOURCE = 'https://www.kogl.or.kr/info/license.do';
export const OPERATIONAL_CONFIRMATION = {
  verification_basis: 'domain_expert_operational_confirmation',
  verified_by_role: 'e뮤지엄 연계 업무 담당자',
  verified_at: '2026-09-12',
  official_condition_source: OFFICIAL_CONDITION_SOURCE,
  public_api_documentation_status: 'partial' as const,
};
export const SCOPE_EVIDENCE = '2026-09-12 e뮤지엄 연계 업무 담당자 실무 확인: 소장품 정보의 glsv는 해당 소장품에 등록된 전체 이미지에 동일하게 적용됨. 공개 API 문서의 적용범위 설명은 부분 확인 상태.';
export const CONDITIONS = {
  '1': { attribution: true, commercial: true, modification: true },
  '2': { attribution: true, commercial: false, modification: true },
  '3': { attribution: true, commercial: true, modification: false },
  '4': { attribution: true, commercial: false, modification: false },
} as const;
export const RULE_CONTEXT = {
  operational_confirmation: OPERATIONAL_CONFIRMATION,
  code_mapping: { '1': 'KOGL-1', '2': 'KOGL-2', '3': 'KOGL-3', '4': 'KOGL-4' },
  applies_to: 'record_all_images',
  official_conditions: { source: OFFICIAL_CONDITION_SOURCE, checked_at: '2026-09-12', conditions: CONDITIONS },
  research_policies: {
    source_conflict: 'A researcher-reviewed eMuseum detail-page mark takes priority; retain both observations and source_conflict.',
    missing_actions: 'Require explicit commercial and modification choices; do not infer from the question.',
    unknown_scope: 'No permit or restriction when image applicability is unknown.',
    scope: 'Only types 1–4. Types 0/AI are outside this study based on the dated operational confirmation; unexpected codes remain unrecognized.',
    image_identity: 'Research collection identifier only; not a permanent eMuseum identifier.',
  },
};
export const supportedType = (value: unknown): value is keyof typeof CONDITIONS => typeof value === 'string' && Object.hasOwn(CONDITIONS,value);

// This interpretation is grounded in the user's dated operational confirmation,
// not in the numeric resemblance of a code or an unobserved /code definition.
export function interpretRecordRights(raw: Rights): Rights {
  const clean: Rights = { ...raw, license_type_verified: null, license_code_source: null, applies_to: 'unknown', scope_evidence: null,
    verified_at: null, verification_status: raw.verification_status === 'conflict' ? 'conflict' : 'unknown',
    verification_basis: null, verified_by_role: null, effective_source: 'none', source_conflict: false, conflict_resolution: null,
    official_condition_source: OFFICIAL_CONDITION_SOURCE, public_api_documentation_status: 'partial' };
  if (raw.observed_location !== 'record' || raw.verification_status === 'conflict' || !supportedType(raw.glsv_raw)) return clean;
  return { ...clean, ...OPERATIONAL_CONFIRMATION, license_type_verified: [raw.glsv_raw],
    license_code_source: 'domain-expert-operational-confirmation:2026-09-12', applies_to: 'record_all_images',
    scope_evidence: SCOPE_EVIDENCE, verification_status: 'verified', effective_source: 'api' };
}

// Validate a researcher observation, not an automatically fetched/verified page.
// Only an exact record link and explicit successful review can override the API.
export function validatePageReview(review: PageReview, recordId: string | null): string | null {
  if (!recordId || review.record_id !== recordId) return '원문 검토와 소장품 ID가 일치해야 합니다.';
  try {
    const u = new URL(review.source_url);
    if (u.protocol !== 'https:' || !['www.emuseum.go.kr','emuseum.go.kr'].includes(u.hostname) || u.port || u.username || u.password ||
        u.pathname !== '/detail' || u.searchParams.getAll('relicId').length !== 1 || u.searchParams.get('relicId') !== recordId ||
        /servicekey|apikey|token|redacted/i.test(u.href)) return '해당 소장품 ID가 포함된 인증정보 없는 e뮤지엄 상세주소가 필요합니다.';
  } catch { return '원문 주소를 확인해 주세요.'; }
  if (review.method !== 'researcher_manual' || !review.reviewer.trim() || !Number.isFinite(Date.parse(review.observed_at))) return '검토자와 확인시각이 필요합니다.';
  if (review.status === 'reviewed') {
    if (!review.record_match_confirmed || !review.displayed_rights_text.trim() || !(supportedType(review.license_type) || review.license_type === 'outside_scope')) return '실제로 읽은 권리표시·유형과 소장품 일치 확인이 필요합니다.';
  } else if (review.license_type !== null) return '차단·접근 실패·표시 없음은 유형 확인 성공으로 저장할 수 없습니다.';
  return null;
}

export function resolveRights(candidate: Candidate): Rights {
  const api = interpretRecordRights(candidate.record.rights), page = candidate.page_review;
  const imageUnexpected = candidate.image.rights.glsv_presence !== 'missing';
  // An unexpected image-level glsv is outside the confirmed API structure.
  if (imageUnexpected) return { ...api, license_type_verified: null, applies_to: 'unknown', verification_status: 'conflict',
    effective_source: 'none', scope_evidence: '확인된 운영 구조와 달리 이미지 항목에 glsv가 관찰되어 추가 확인이 필요함.' };
  if (!page || validatePageReview(page,candidate.record.id) || page.status !== 'reviewed') return api;
  const apiType = api.license_type_verified?.[0];
  const conflict = api.verification_status === 'conflict' || Boolean(apiType && apiType !== page.license_type);
  return { ...api, license_type_verified: supportedType(page.license_type) ? [page.license_type] : null,
    applies_to: 'record_all_images', scope_evidence: SCOPE_EVIDENCE,
    verification_basis: 'researcher_manual_page_review', verified_by_role: '연구자 원문 검토', verified_at: page.observed_at,
    verification_status: supportedType(page.license_type) ? 'verified' : 'partial',
    effective_source: 'emuseum_detail_page', license_observation_source: page.source_url,
    source_conflict: conflict, conflict_resolution: conflict ? 'detail_page_priority' : null };
}
