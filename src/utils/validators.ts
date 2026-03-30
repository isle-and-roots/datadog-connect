/** シェル引数をシングルクォートでエスケープ（インジェクション防止） */
export function escapeShellArg(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

export function validateAwsAccountId(value: string): string | boolean {
  return /^\d{12}$/.test(value) || "AWS Account ID は12桁の数字です";
}

export function validateGcpProjectId(value: string): string | boolean {
  return /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value) || "GCP Project IDは英小文字で始まり、英小文字・数字・ハイフンの6-30文字です";
}

export function validateAzureSubscriptionId(value: string): string | boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) || "Azure Subscription IDはUUID形式です";
}

export function validateNotEmpty(value: string): string | boolean {
  return value.trim().length > 0 || "値を入力してください";
}

export function validateUrl(value: string): string | boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return "有効なURLを入力してください";
  }
}
