const FILE_NAME_OR_PATH_RE =
  /(?:^|[\s("'`])(?:\/[^\s"'`]+|(?:\.{1,2}\/)?(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+\.[A-Za-z0-9]{1,8}|[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9]{1,8})(?=$|[\s)"'`,.;:，。；：、])/u;
const LOCAL_PATH_RE =
  /(?:^|[\s("'`])(?:\/[^\s"'`]+|(?:\.{1,2}\/)?(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+(?:\.[A-Za-z0-9._-]+)?)(?=$|[\s)"'`,.;:，。；：、])/u;
const BARE_FILENAME_RE =
  /(?:^|[\s("'`])(?:[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9]{1,8})(?=$|[\s)"'`,.;:，。；：、])/u;

const EXPLICIT_ARTIFACT_TERM_RE =
  /\b(download|export|artifact|save\s+(?:as|to)|write\s+(?:to|a\s+file|the\s+file)|(?:generate|create|produce|build|return|provide|draft)\s+(?:a\s+|an\s+|the\s+)?(?:file|document|doc|markdown|md|html|json|csv|yaml|yml|xml|pdf|pptx?|docx?|xlsx?|zip)|(?:markdown|md|html|json|csv|yaml|yml|xml|pdf|pptx?|docx?|xlsx?|zip)\s+file|full\s+file\s+contents)\b/i;

const EXPLICIT_CHINESE_ARTIFACT_RE =
  /(下载|导出|保存到|保存为|附件|写入\s*文件|(?:生成|创建|产出|输出|提供|返回|起草|草拟|给我)\s*(?:一份|一个)?\s*(?:markdown|md|html|json|csv|pdf|ppt|pptx|docx|文件|文档|产物))/i;

const READ_ONLY_LOCAL_OPERATION_RE =
  /\b(?:read|quote|inspect|open|summari[sz]e|explain|analy[sz]e|review|check)\b|(?:读取|阅读|查看|打开|总结|解释|分析|审计|检查)/i;
const MUTATING_LOCAL_OPERATION_RE =
  /\b(?:read_file|write_file|edit|modify|update|delete|move|copy|append|rename)\b|(?:编辑|修改|删除|移动|复制|追加|重命名)/i;

function normalizeIntentText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stripUrls(value: string): string {
  return value.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '');
}

function hasLocalFileReference(value: string): boolean {
  return LOCAL_PATH_RE.test(value) || BARE_FILENAME_RE.test(value);
}

function hasExplicitArtifactCreationIntent(value: string): boolean {
  return EXPLICIT_ARTIFACT_TERM_RE.test(value) || EXPLICIT_CHINESE_ARTIFACT_RE.test(value);
}

export function isLocalFileOperationIntent(taskDescription: string): boolean {
  const normalized = stripUrls(normalizeIntentText(taskDescription));
  if (!normalized || !hasLocalFileReference(normalized)) return false;
  if (MUTATING_LOCAL_OPERATION_RE.test(normalized)) return true;
  return (
    READ_ONLY_LOCAL_OPERATION_RE.test(normalized) && !hasExplicitArtifactCreationIntent(normalized)
  );
}

export function isUserRequestedDeliverableIntent(taskDescription: string): boolean {
  const normalized = normalizeIntentText(taskDescription);
  if (!normalized) return false;
  if (normalized.includes('://')) {
    const withoutUrls = stripUrls(normalized);
    return isUserRequestedDeliverableIntent(withoutUrls);
  }
  return FILE_NAME_OR_PATH_RE.test(normalized) || hasExplicitArtifactCreationIntent(normalized);
}

export function isNewDeliverableRequest(taskDescription: string): boolean {
  return (
    isUserRequestedDeliverableIntent(taskDescription) &&
    !isLocalFileOperationIntent(taskDescription)
  );
}
