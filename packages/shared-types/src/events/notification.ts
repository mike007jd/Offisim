export interface NotificationPayload {
  readonly notificationId: string;
  readonly level: 'info' | 'success' | 'warning' | 'error';
  readonly title: string;
  readonly message: string;
  readonly source: 'runtime' | 'market' | 'install' | 'hr';
  readonly actionUrl?: string;
  readonly employeeId?: string;
  readonly dismissable: boolean;
  readonly timestamp: number;
}

export interface NotificationDismissedPayload {
  readonly notificationId: string;
}
