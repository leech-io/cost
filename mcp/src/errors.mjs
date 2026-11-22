const messages = {
  INVALID_CONFIG: 'MCP 配置无效；请检查后端 origin、认证模式和仓库外凭据文件路径。',
  INVALID_ARGUMENT: '查询参数无效；请检查日期、筛选条件和分页范围。',
  CREDENTIAL_UNAVAILABLE: '无法安全读取凭据文件；请检查路径、归属、权限、大小和内容。',
  AUTH_REQUIRED: '登录会话无效或已过期；请重新微信登录并更新本机凭据文件。',
  PROFILE_REQUIRED: '请在现有小程序中完成账户昵称后重试。',
  ACCESS_DENIED: '后端拒绝访问。',
  UPSTREAM_UNAVAILABLE: 'Cost 后端暂不可用，或请求已取消、超时。',
  UPSTREAM_INVALID_RESPONSE: 'Cost 后端响应格式或数值无效。',
  RESPONSE_TOO_LARGE: '查询结果过大；请缩小日期范围、页大小或分类数量。',
};
export class CostError extends Error {
  constructor(code) { super(messages[code] ?? messages.UPSTREAM_UNAVAILABLE); this.name = 'CostError'; this.code = code; }
}
export function publicError(error) {
  const code = error instanceof CostError ? error.code : 'UPSTREAM_UNAVAILABLE';
  return { code, message: new CostError(code).message };
}
