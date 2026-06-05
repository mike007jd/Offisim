//! Per-lane registry of in-flight request cancellation tokens.
//!
//! Each model-transport lane (`llm_transport` gateway, `claude_agent_host`,
//! `codex_agent_host`) owns ONE `InFlightRegistry` static. Keeping a separate
//! map per lane is deliberate isolation — a lane's abort command must only
//! cancel that lane's own requests, never another lane's. This module shares
//! the register/clear/pluck logic so a change to the cancellation strategy
//! (TTL cleanup, metrics, poison recovery) happens in one place instead of
//! three character-identical copies.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};

use once_cell::sync::Lazy;
use tokio_util::sync::CancellationToken;

type TokenMap = Mutex<HashMap<String, CancellationToken>>;

fn new_token_map() -> TokenMap {
    Mutex::new(HashMap::new())
}

pub struct InFlightRegistry {
    /// Lane name, used only in the lock-poison panic message.
    name: &'static str,
    map: Lazy<TokenMap>,
}

impl InFlightRegistry {
    pub const fn new(name: &'static str) -> Self {
        Self {
            name,
            map: Lazy::new(new_token_map),
        }
    }

    fn guard(&self) -> MutexGuard<'_, HashMap<String, CancellationToken>> {
        self.map
            .lock()
            .unwrap_or_else(|_| panic!("{} in_flight poisoned", self.name))
    }

    /// Register a fresh cancellation token for `id` and return its handle.
    pub fn register(&self, id: &str) -> CancellationToken {
        let token = CancellationToken::new();
        self.guard().insert(id.to_string(), token.clone());
        token
    }

    /// Drop the token for `id` once its request completes.
    pub fn clear(&self, id: &str) {
        self.guard().remove(id);
    }

    /// Remove and return the token for `id` so an abort command can cancel it.
    pub fn pluck(&self, id: &str) -> Option<CancellationToken> {
        self.guard().remove(id)
    }
}
