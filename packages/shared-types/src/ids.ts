declare const __brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type CompanyId = Brand<string, 'CompanyId'>;
export type EmployeeId = Brand<string, 'EmployeeId'>;
export type TaskId = Brand<string, 'TaskId'>;
export type MeetingId = Brand<string, 'MeetingId'>;
export type InstallTxnId = Brand<string, 'InstallTxnId'>;
export type InstalledPackageId = Brand<string, 'InstalledPackageId'>;
export type InstalledAssetId = Brand<string, 'InstalledAssetId'>;
export type ListingId = Brand<string, 'ListingId'>;
export type PackageId = Brand<string, 'PackageId'>;
export type AssetBindingId = Brand<string, 'AssetBindingId'>;
export type ReportId = Brand<string, 'ReportId'>;
