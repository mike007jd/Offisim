use keyring::{Entry, Error as KeyringError};
use serde::Serialize;

const SERVICE_NAME: &str = "com.offisim.desktop";
const ACCOUNT_NAME: &str = "runtime.secret";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSecretStatus {
    has_secret: bool,
}

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE_NAME, ACCOUNT_NAME).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn runtime_secret_status() -> Result<RuntimeSecretStatus, String> {
    match entry()?.get_password() {
        Ok(secret) => Ok(RuntimeSecretStatus {
            has_secret: !secret.trim().is_empty(),
        }),
        Err(KeyringError::NoEntry) => Ok(RuntimeSecretStatus { has_secret: false }),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
pub fn runtime_secret_set(secret: String) -> Result<(), String> {
    let trimmed = secret.trim();
    if trimmed.is_empty() {
        return Err("Secret cannot be empty".into());
    }
    entry()?.set_password(trimmed).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn runtime_secret_clear() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}
