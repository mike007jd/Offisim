use crate::mcp_bridge::types::JsonRpcMessage;
use crate::sidecar_stderr::{read_capped_line, MAX_SIDECAR_OUTPUT_BYTES};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncWriteExt, BufReader, BufWriter};
use tokio::process::{ChildStderr, ChildStdin, ChildStdout};
use tokio::sync::{mpsc, oneshot};

/// Reads NDJSON from stdout, parses into JsonRpcMessage, dispatches to channel.
pub async fn read_loop(stdout: ChildStdout, tx: mpsc::Sender<JsonRpcMessage>, pid: Option<u32>) {
    let mut reader = BufReader::new(stdout);
    loop {
        let line = match read_capped_line(&mut reader, MAX_SIDECAR_OUTPUT_BYTES).await {
            Ok(Some(bytes)) => String::from_utf8_lossy(&bytes).into_owned(),
            Ok(None) => break,
            Err(error) => {
                eprintln!("[mcp_bridge] terminating server after stdout protocol error: {error}");
                terminate_process(pid);
                break;
            }
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match serde_json::from_str::<JsonRpcMessage>(trimmed) {
            Ok(msg) => {
                if tx.send(msg).await.is_err() {
                    break; // receiver dropped
                }
            }
            Err(e) => {
                eprintln!("[mcp_bridge] malformed JSON-RPC line: {e}");
            }
        }
    }
}

pub async fn drain_stderr(stderr: ChildStderr, pid: Option<u32>) {
    let mut reader = BufReader::new(stderr);
    loop {
        let line = match read_capped_line(&mut reader, MAX_SIDECAR_OUTPUT_BYTES).await {
            Ok(Some(bytes)) => String::from_utf8_lossy(&bytes).into_owned(),
            Ok(None) => break,
            Err(error) => {
                eprintln!("[mcp_bridge] terminating server after stderr limit error: {error}");
                terminate_process(pid);
                break;
            }
        };
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            eprintln!("[mcp_bridge][stderr] {trimmed}");
        }
    }
}

fn terminate_process(pid: Option<u32>) {
    #[cfg(unix)]
    if let Some(pid) = pid {
        let _ = unsafe { libc::kill(pid as i32, libc::SIGKILL) };
    }
    #[cfg(not(unix))]
    let _ = pid;
}

/// Writes a JsonRpcMessage as NDJSON (serialize + \n + flush).
pub async fn write_message(
    stdin: &mut BufWriter<ChildStdin>,
    msg: &JsonRpcMessage,
) -> Result<(), std::io::Error> {
    let bytes = serde_json::to_vec(msg)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    stdin.write_all(&bytes).await?;
    stdin.write_all(b"\n").await?;
    stdin.flush().await?;
    Ok(())
}

/// Manages pending request-response correlation.
pub struct RequestTracker {
    pending: Arc<Mutex<HashMap<i64, oneshot::Sender<JsonRpcMessage>>>>,
    next_id: Arc<Mutex<i64>>,
}

impl RequestTracker {
    pub fn new() -> Self {
        Self {
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_id: Arc::new(Mutex::new(1)),
        }
    }

    pub fn next_id(&self) -> i64 {
        let mut id = self.next_id.lock().unwrap();
        let current = *id;
        *id += 1;
        current
    }

    pub fn register(&self, id: i64) -> oneshot::Receiver<JsonRpcMessage> {
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);
        rx
    }

    pub fn clone_inner(&self) -> RequestTrackerInner {
        RequestTrackerInner {
            pending: Arc::clone(&self.pending),
        }
    }
}

pub struct RequestTrackerInner {
    pending: Arc<Mutex<HashMap<i64, oneshot::Sender<JsonRpcMessage>>>>,
}

impl RequestTrackerInner {
    pub fn try_resolve(&self, msg: &JsonRpcMessage) -> bool {
        if let Some(id_val) = &msg.id {
            if let Some(id_num) = id_val.as_i64() {
                if let Some(tx) = self.pending.lock().unwrap().remove(&id_num) {
                    let _ = tx.send(msg.clone());
                    return true;
                }
            }
        }
        false
    }
}
