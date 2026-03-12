use crate::mcp_bridge::types::JsonRpcMessage;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::process::{ChildStdin, ChildStdout};
use tokio::sync::{mpsc, oneshot};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Reads NDJSON from stdout, parses into JsonRpcMessage, dispatches to channel.
pub async fn read_loop(
    stdout: ChildStdout,
    tx: mpsc::UnboundedSender<JsonRpcMessage>,
) {
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match serde_json::from_str::<JsonRpcMessage>(trimmed) {
            Ok(msg) => {
                if tx.send(msg).is_err() {
                    break; // receiver dropped
                }
            }
            Err(e) => {
                eprintln!("[mcp_bridge] malformed JSON-RPC line: {e}");
            }
        }
    }
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

    /// Try to match an incoming message to a pending request.
    /// Returns true if matched (response), false if not (notification).
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
