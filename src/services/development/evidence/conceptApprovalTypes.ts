/** Leaf type shared by proposed requirements and structural reference checks. */
export interface ConceptApprovalReference {
  approvalId: string;
  claimsVersion: string;
  requirementSha256: string;
  decision: 'approved';
}
