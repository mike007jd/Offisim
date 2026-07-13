use serde::Serialize;
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Mutex;

const NATIVE_STAGE_AUDIT_FILE: &str = "native-stage-audit.jsonl";
static NATIVE_STAGE_AUDIT_LOCK: Mutex<()> = Mutex::new(());

pub fn append<T: Serialize>(record: &T) {
    let Ok(mut line) = serde_json::to_vec(record) else {
        return;
    };
    line.push(b'\n');
    let _guard = NATIVE_STAGE_AUDIT_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let Ok(directory) = crate::local_paths::offisim_home_dir() else {
        return;
    };
    if std::fs::create_dir_all(&directory).is_err() {
        return;
    }
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(directory.join(NATIVE_STAGE_AUDIT_FILE))
    {
        let _ = file.write_all(&line);
    }
}
