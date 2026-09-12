const RULES=[
  ['private_key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i],
  ['github_token',/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/],
  ['aws_access_key',/\bAKIA[0-9A-Z]{16}\b/],
  ['bearer_token',/\bBearer\s+[A-Za-z0-9._~+\/-]+=*\b/i],
  ['generic_secret',/\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*[^\s,;]{8,}/i]
];
function flatten(value,out=[]){if(value==null)return out;if(typeof value==='string')out.push(value);else if(Array.isArray(value))for(const x of value)flatten(x,out);else if(typeof value==='object')for(const x of Object.values(value))flatten(x,out);return out}
export function detectSecrets(value){const text=flatten(value).join('\n');return RULES.filter(([,rx])=>rx.test(text)).map(([type])=>type)}
export function assertAITransmissionAllowed(project,payload){const findings=detectSecrets(payload);if(findings.length&&!project.aiPolicy?.sensitiveDataTransmissionAllowed){const e=new Error(`AI transmission blocked by secret scan: ${findings.join(', ')}`);e.code='AI_SENSITIVE_DATA_BLOCKED';e.findings=findings;throw e}return findings}
